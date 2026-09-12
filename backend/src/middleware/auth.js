const jwt = require('jsonwebtoken');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อนใช้งานส่วนนี้' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub || payload.id);
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
