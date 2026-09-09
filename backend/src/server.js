require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// เรียกไฟล์ db.js ที่อยู่ใน src เดียวกัน
require('./db'); 

// เรียก rateLimiters.js จากโฟลเดอร์ src เดียวกัน
const { apiLimiter, authLimiter, moneyLimiter, otpLimiter } = require('./rateLimiters');

// เรียกไฟล์ในโฟลเดอร์ routes
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const listingRoutes = require('./routes/listings');
const orderRoutes = require('./routes/orders');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (จำเป็นสำหรับ Render / Heroku เพื่อให้ Rate Limit อ่าน IP ถูกต้อง)
app.set('trust proxy', 1);

// ===== 1. ปลดล็อก CORS ให้รองรับ Netlify และทุกโดเมน =====
app.use(
  cors({
    origin: '*', // ปลดล็อกให้ Netlify ยิง API เข้ามาได้โดยไม่ติด Failed to fetch
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ===== 2. ตั้งค่า Helmet Security Headers ไม่ให้บล็อกการดึงข้อมูล =====
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // ปิด CSP ชั่วคราวเพื่อป้องกัน บล็อกภาพ/API จากโดเมนต่างที่
  })
);

// Middleware สำหรับแปลง Body เป็น JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ใช้ Rate Limiters
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
app.use('/api/wallet/', moneyLimiter);
app.use('/api/otp/', otpLimiter);

// ===== 3. Routes สำหรับ API =====
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);

// Route สำหรับเช็กสถานะเซิร์ฟเวอร์
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// หน้าแรก fallback
app.get('/', (req, res) => {
  res.send('G-Coin Market API is running!');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
