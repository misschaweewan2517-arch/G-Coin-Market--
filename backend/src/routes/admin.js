const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/users', (req, res) => {
  const rows = db
    .prepare('SELECT id, username, role, balance_real, balance_bonus, created_at FROM users ORDER BY id')
    .all();
  res.json({ users: rows });
});

// "Mint" coins to a user. This ALWAYS lands in balance_bonus, never balance_real,
// and always requires a reason. Bonus coins can be spent on the marketplace but
// can never be withdrawn as real THB (see withdrawals.js) — this is the guardrail
// that stops the feature from being a "print money, cash it out" backdoor.
router.post('/mint', (req, res) => {
  const { username, amount, reason } = req.body || {};
  const amt = Number(amount);
  if (!username || !Number.isInteger(amt) || amt === 0 || !reason || !reason.trim()) {
    return res.status(400).json({ error: 'กรุณาระบุ username, จำนวนเหรียญ (ไม่เป็น 0) และเหตุผลให้ครบถ้วน' });
  }

  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });

  if (amt < 0 && target.balance_bonus + amt < 0) {
    return res.status(400).json({ error: 'ผู้ใช้นี้มีเหรียญโบนัสไม่พอให้หัก' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance_bonus = balance_bonus + ? WHERE id = ?').run(amt, target.id);
    const action = db
      .prepare(
        `INSERT INTO admin_actions (admin_id, action, target_user_id, amount, reason)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(req.user.id, amt >= 0 ? 'mint' : 'deduct', target.id, Math.abs(amt), reason.trim());
    db.prepare(
      `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
       VALUES (?, ?, 0, ?, 'admin_action', ?, ?)`
    ).run(target.id, amt >= 0 ? 'admin_mint' : 'admin_deduct', amt, action.lastInsertRowid, `แอดมิน ${req.user.username}: ${reason.trim()}`);
    return action.lastInsertRowid;
  });

  const actionId = tx();
  const updated = db.prepare('SELECT balance_real, balance_bonus FROM users WHERE id = ?').get(target.id);
  res.status(201).json({ action_id: actionId, balance_real: updated.balance_real, balance_bonus: updated.balance_bonus });
});

router.get('/audit-log', (req, res) => {
  const rows = db
    .prepare(
      `SELECT admin_actions.*, admins.username as admin_username, targets.username as target_username
       FROM admin_actions
       JOIN users admins ON admins.id = admin_actions.admin_id
       LEFT JOIN users targets ON targets.id = admin_actions.target_user_id
       ORDER BY admin_actions.id DESC LIMIT 300`
    )
    .all();
  res.json({ audit_log: rows });
});

router.get('/withdrawals', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db
        .prepare(
          `SELECT withdrawals.*, users.username as seller_username FROM withdrawals
           JOIN users ON users.id = withdrawals.seller_id WHERE withdrawals.status = ?
           ORDER BY withdrawals.id DESC`
        )
        .all(status)
    : db
        .prepare(
          `SELECT withdrawals.*, users.username as seller_username FROM withdrawals
           JOIN users ON users.id = withdrawals.seller_id ORDER BY withdrawals.id DESC`
        )
        .all();
  res.json({ withdrawals: rows });
});

router.post('/withdrawals/:id/approve', (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'ไม่พบรายการถอนเงินนี้' });
  if (w.status !== 'pending') return res.status(409).json({ error: 'รายการนี้ถูกดำเนินการไปแล้ว' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE withdrawals SET status = 'completed', processed_by = ?, processed_at = datetime('now') WHERE id = ?`)
      .run(req.user.id, w.id);
    db.prepare(
      `INSERT INTO admin_actions (admin_id, action, target_user_id, amount, reason, ref_id)
       VALUES (?, 'approve_withdrawal', ?, ?, ?, ?)`
    ).run(req.user.id, w.seller_id, w.coin_amount, `อนุมัติโอน ${w.payout_thb} บาท`, w.id);
  });
  tx();
  res.json({ ok: true });
});

// Rejecting a withdrawal refunds the held coins back to balance_real.
router.post('/withdrawals/:id/reject', (req, res) => {
  const { reason } = req.body || {};
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'ไม่พบรายการถอนเงินนี้' });
  if (w.status !== 'pending') return res.status(409).json({ error: 'รายการนี้ถูกดำเนินการไปแล้ว' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE withdrawals SET status = 'rejected', processed_by = ?, processed_at = datetime('now') WHERE id = ?`)
      .run(req.user.id, w.id);
    db.prepare('UPDATE users SET balance_real = balance_real + ? WHERE id = ?').run(w.coin_amount, w.seller_id);
    db.prepare(
      `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
       VALUES (?, 'withdrawal_reject_refund', ?, 0, 'withdrawal', ?, ?)`
    ).run(w.seller_id, w.coin_amount, w.id, `คำขอถอนเงินถูกปฏิเสธ: ${reason || 'ไม่ระบุเหตุผล'}`);
    db.prepare(
      `INSERT INTO admin_actions (admin_id, action, target_user_id, amount, reason, ref_id)
       VALUES (?, 'reject_withdrawal', ?, ?, ?, ?)`
    ).run(req.user.id, w.seller_id, w.coin_amount, reason || 'ไม่ระบุเหตุผล', w.id);
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
