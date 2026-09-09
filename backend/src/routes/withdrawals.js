const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const FEE_PERCENT = Number(process.env.WITHDRAWAL_FEE_PERCENT || 10);
const COIN_RATE = Number(process.env.COIN_TO_THB_RATE || 1);

router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM withdrawals WHERE seller_id = ? ORDER BY id DESC')
    .all(req.user.id);
  res.json({ withdrawals: rows });
});

// Request a withdrawal. Coins are deducted immediately (held) so the same
// balance can't be requested twice; they are only ever taken from balance_real.
router.post('/', requireAuth, (req, res) => {
  const { coin_amount } = req.body || {};
  const amt = Number(coin_amount);
  if (!Number.isInteger(amt) || amt <= 0) {
    return res.status(400).json({ error: 'จำนวนเหรียญไม่ถูกต้อง' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.bank_account_number && !user.promptpay_id) {
    return res.status(400).json({ error: 'กรุณาเพิ่มบัญชีธนาคารหรือพร้อมเพย์ก่อนถอนเงิน' });
  }
  if (user.balance_real < amt) {
    return res.status(402).json({
      error:
        'ยอดเหรียญที่ถอนได้จริงไม่เพียงพอ (เหรียญจากการปรับยอดโดยแอดมินไม่สามารถถอนเป็นเงินจริงได้ ใช้ได้เฉพาะซื้อสินค้าในระบบ)',
    });
  }

  const feeThb = Math.round(amt * COIN_RATE * (FEE_PERCENT / 100) * 100) / 100;
  const payoutThb = Math.round((amt * COIN_RATE - feeThb) * 100) / 100;

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance_real = balance_real - ? WHERE id = ?').run(amt, user.id);
    const w = db
      .prepare(
        `INSERT INTO withdrawals
         (seller_id, coin_amount, fee_percent, fee_thb, payout_thb, bank_name, bank_account_number, promptpay_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(user.id, amt, FEE_PERCENT, feeThb, payoutThb, user.bank_name, user.bank_account_number, user.promptpay_id);
    db.prepare(
      `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
       VALUES (?, 'withdrawal_hold', ?, 0, 'withdrawal', ?, ?)`
    ).run(user.id, -amt, w.lastInsertRowid, `ขอถอนเงิน ${amt} coins (ค่าธรรมเนียม ${FEE_PERCENT}%)`);
    return w.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json({ withdrawal_id: id, fee_thb: feeThb, payout_thb: payoutThb, status: 'pending' });
});

module.exports = router;
