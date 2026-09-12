const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

// ===== 1. นำเข้า Middleware ป้องกันปัญหา Route.get() undefined =====
let requireAuth;
try {
  const authMiddleware = require('../middleware/auth');
  requireAuth = authMiddleware.requireAuth || authMiddleware;
} catch (e) {
  // Fallback กรณีหาไฟล์ middleware ไม่เจอ
  requireAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อนใช้งาน' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
      req.user = payload;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token ไม่ถูกต้อง' });
    }
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash || user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'secret_key',
      { expiresIn: '7d' }
    );

    const { password: _, password_hash: __, ...userWithoutPassword } = user;
    res.json({ token, user: userWithoutPassword });

  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
  }
});

// GET /api/auth/me (ใช้ requireAuth middleware)
router.get('/me', requireAuth, (req, res) => {
  try {
    const userId = req.user.sub || req.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });

    const { password: _, password_hash: __, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

module.exports = router;
