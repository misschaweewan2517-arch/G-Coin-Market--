const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const omise = require('../payment/omise');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const u = db.prepare('SELECT balance_real, balance_bonus FROM users WHERE id = ?').get(req.user.id);
  res.json({
    balance_real: u.balance_real,
    balance_bonus: u.balance_bonus,
    balance_total: u.balance_real + u.balance_bonus,
  });
});

router.get('/ledger', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 200')
    .all(req.user.id);
  res.json({ ledger: rows });
});

// ===== Real deposits =====
//
// 1 G-Coin = 1 THB (see COIN_TO_THB_RATE in .env if you ever want that to
// diverge). The flow is: client asks us to create a charge -> we create it
// with Omise and return payment instructions (QR code / card form) -> the
// customer pays *at Omise*, not on our server -> Omise calls our webhook ->
// the webhook independently re-checks the charge status with Omise's API and
// ONLY THEN credits balance_real. The client can never credit its own wallet
// directly — that request only ever creates a 'pending' row.

// Step 1: start a deposit. For PromptPay this returns a QR code to display.
// For card payments, the frontend must first tokenize the card with Omise.js
// in the browser (raw card numbers must never reach this server) and pass
// the resulting token here as `card_token`.
router.post('/deposit/create', requireAuth, async (req, res) => {
  const amount = Number(req.body?.amount);
  const method = req.body?.method;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
  }
  if (!['promptpay', 'credit_card'].includes(method)) {
    return res.status(400).json({ error: 'ช่องทางชำระเงินไม่ถูกต้อง' });
  }
  if (method === 'credit_card' && !req.body?.card_token) {
    return res.status(400).json({ error: 'ไม่พบข้อมูลบัตร (card token)' });
  }

  try {
    const gatewayResult =
      method === 'promptpay'
        ? await omise.createPromptPayCharge(amount, `Deposit for user #${req.user.id}`)
        : await omise.createCardCharge(amount, req.body.card_token, `Deposit for user #${req.user.id}`);

    const dep = db
      .prepare(
        `INSERT INTO deposits (user_id, amount, method, status, gateway_charge_id) VALUES (?, ?, ?, 'pending', ?)`
      )
      .run(req.user.id, amount, method, gatewayResult.chargeId);

    res.status(201).json({
      deposit_id: dep.lastInsertRowid,
      charge_id: gatewayResult.chargeId,
      status: gatewayResult.status,
      qr_image_url: gatewayResult.qrImageUrl || null,
    });
  } catch (err) {
    console.error('[deposit/create]', err);
    res.status(502).json({ error: err.message || 'เชื่อมต่อผู้ให้บริการชำระเงินไม่สำเร็จ' });
  }
});

// Step 2 (frontend polls this while waiting for the customer to scan/pay).
// Read-only — this can never credit a balance, so it's safe for the client
// to call freely.
router.get('/deposit/:id/status', requireAuth, (req, res) => {
  const dep = db
    .prepare('SELECT * FROM deposits WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!dep) return res.status(404).json({ error: 'ไม่พบรายการเติมเงินนี้' });
  res.json({ status: dep.status, amount: dep.amount });
});

module.exports = router;
