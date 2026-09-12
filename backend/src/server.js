require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// เรียกไฟล์ db.js
require('./db'); 

// เรียกไฟล์ในโฟลเดอร์ routes
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const listingRoutes = require('./routes/listings');
const orderRoutes = require('./routes/orders');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

const app = express();

// Trust proxy สำหรับ Render/Heroku (ตั้งค่า 1 หรือ true)
app.set('trust proxy', 1);

// ===== 1. ปลดล็อก CORS สมบูรณ์แบบ =====
app.use(cors());
app.options('*', cors());

// ===== 2. Helmet Security Headers =====
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

// Middleware สำหรับแปลง Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== 3. Routes สำหรับ API (ถอด Limiter ออกเพื่อป้องกัน IP Block บน Render) =====
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
