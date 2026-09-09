const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendOtp } = require('../notify');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts Thai mobile numbers with or without a country code: 0812345678 or +66812345678.
const PHONE_RE = /^(0\d{8,9}|\+?\d{9,15})$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase() || null;
}
function normalizePhone(phone) {
  return String(phone || '').trim().replace(/[\s-]/g, '') || null;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    phone: u.phone,
    role: u.role,
    balance_real: u.balance_real,
    balance_bonus: u.balance_bonus,
    bank_name: u.bank_name,
    bank_account_number: u.bank_account_number,
    promptpay_id: u.promptpay_id,
  };
}

router.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  const email = normalizeEmail(req.body?.email);
  const phone = normalizePhone(req.body?.phone);

  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน (อย่างน้อย 4 ตัวอักษร)' });
  }
  // At least one contact channel is required so "forgot password" always has
  // somewhere to send the OTP — an account with neither is unrecoverable.
  if (!email && !phone) {
    return res.status(400).json({ error: 'กรุณากรอกอีเมลหรือเบอร์โทรศัพท์อย่างน้อย 1 ช่องทาง (ใช้สำหรับกู้คืนรหัสผ่าน)' });
  }
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }
  if (phone && !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
  if (email && db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
  }
  if (phone && db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) {
    return res.status(409).json({ error: 'เบอร์โทรศัพท์นี้ถูกใช้แล้ว' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare(`INSERT INTO users (username, password_hash, email, phone, role) VALUES (?, ?, ?, ?, 'user')`)
    .run(username, hash, email, phone);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(current_password || '', req.user.password_hash)) {
    return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
  }
  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// ===== Forgot password (email or phone OTP) =====
//
// Flow: user submits their email OR phone -> we generate a 6-digit code,
// store only its SHA-256 hash (with a short expiry), and send the plaintext
// code out via that channel. User then submits the code + a new password to
// /reset-password, which checks the hash + expiry + attempt count before
// allowing the change. The response to /forgot-password is deliberately the
// same whether or not the account exists, so this endpoint can't be used to
// find out which emails/phones are registered.

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

router.post('/forgot-password', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) return res.status(400).json({ error: 'กรุณากรอกอีเมลหรือเบอร์โทรศัพท์' });

  const isEmail = EMAIL_RE.test(identifier);
  const channel = isEmail ? 'email' : 'phone';
  const destination = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);

  const user = db
    .prepare(`SELECT * FROM users WHERE ${isEmail ? 'email' : 'phone'} = ?`)
    .get(destination);

  // Always respond the same way whether the account exists or not — otherwise
  // this endpoint becomes a way to enumerate registered emails/phones.
  const genericResponse = { ok: true, message: 'หากมีบัญชีที่ผูกกับข้อมูลนี้ ระบบได้ส่งรหัสยืนยันไปให้แล้ว' };

  if (!user) return res.json(genericResponse);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO password_resets (user_id, channel, destination, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(user.id, channel, destination, hashCode(code), expiresAt);

  try {
    await sendOtp(channel, destination, code);
  } catch (err) {
    // Don't leak delivery failures to the client (would confirm the account
    // exists), but log server-side so you notice a misconfigured SMTP/SMS setup.
    console.error('[forgot-password] failed to send OTP:', err.message);
  }

  res.json(genericResponse);
});

router.post('/reset-password', (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const code = String(req.body?.code || '').trim();
  const new_password = String(req.body?.new_password || '');

  if (!identifier || !code) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
  if (new_password.length < 4) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });

  const isEmail = EMAIL_RE.test(identifier);
  const destination = isEmail ? normalizeEmail(identifier) : normalizePhone(identifier);

  const user = db
    .prepare(`SELECT * FROM users WHERE ${isEmail ? 'email' : 'phone'} = ?`)
    .get(destination);
  if (!user) return res.status(400).json({ error: 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ' });

  const reset = db
    .prepare(
      `SELECT * FROM password_resets WHERE user_id = ? AND destination = ? AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(user.id, destination);

  if (!reset) return res.status(400).json({ error: 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ' });
  if (new Date(reset.expires_at) < new Date()) {
    return res.status(400).json({ error: 'รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่' });
  }
  if (reset.attempts >= 5) {
    return res.status(429).json({ error: 'กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่' });
  }
  if (reset.code_hash !== hashCode(code)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(reset.id);
    return res.status(400).json({ error: 'รหัสยืนยันไม่ถูกต้อง' });
  }

  const hash = bcrypt.hashSync(new_password, 12);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('UPDATE password_resets SET consumed_at = datetime(\'now\') WHERE id = ?').run(reset.id);
  })();

  res.json({ ok: true });
});

router.put('/payout-details', requireAuth, (req, res) => {
  const { bank_name, bank_account_number, promptpay_id } = req.body || {};
  db.prepare(
    'UPDATE users SET bank_name = ?, bank_account_number = ?, promptpay_id = ? WHERE id = ?'
  ).run(bank_name || null, bank_account_number || null, promptpay_id || null, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;
