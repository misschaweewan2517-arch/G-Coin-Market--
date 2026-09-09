require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// เรียกไฟล์ db.js ที่อยู่ใน src เดียวกัน
require('./db'); 

// เรียก rateLimiters.js จากโฟลเดอร์ src เดียวกัน (ไม่ต้องมี /payment)
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

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS allow-list
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: false,
  })
);

app.use(express.json({ limit: '2mb' }));
// ชี้พาธโฟลเดอร์ uploads ถอยขึ้นไปเก็บไว้ใน backend/uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// General rate limit & specific rate limiters
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth/reset-password', otpLimiter);
app.use('/api/wallet/deposit', moneyLimiter);
app.use('/api/orders', moneyLimiter);
app.use('/api/withdrawals', moneyLimiter);

// App routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Centralized error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.message && err.message.includes('รองรับเฉพาะไฟล์รูปภาพ')) {
    return res.status(400).json({ error: err.message });
  }
  const message = isProd ? 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่' : err.message;
  res.status(err.status || 500).json({ error: message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
