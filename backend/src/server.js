require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

require('./db'); // initializes schema + bootstrap admin on first run

const { apiLimiter, authLimiter, moneyLimiter, otpLimiter } = require('./rateLimiters');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const listingRoutes = require('./routes/listings');
const orderRoutes = require('./routes/orders');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Security headers. This API only ever returns JSON/static uploads (the HTML
// frontend is a separate static site), so the default CSP doesn't need to
// allow inline scripts here.
//
// crossOriginResourcePolicy is relaxed to 'cross-origin': helmet's default
// ('same-origin') blocks the browser from loading /uploads/* images when the
// frontend is served from a different origin/port than this API — which is
// exactly this app's setup. The uploaded listing photos are meant to be
// public anyway, so this is safe; nothing sensitive is served from /uploads.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS allow-list. Set FRONTEND_ORIGIN in .env to a comma-separated list of
// real domains before going to production — "*" is fine for local dev only.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: false,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// General rate limit on every API route, tighter limits layered on top for
// auth and money-moving endpoints to slow down brute force / abuse.
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth/reset-password', otpLimiter);
app.use('/api/wallet/deposit', moneyLimiter);
app.use('/api/orders', moneyLimiter);
app.use('/api/withdrawals', moneyLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
// Called by the payment gateway server-to-server, not by the browser — no
// JWT auth (Omise doesn't have one), no CORS restriction needed either.
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Centralized error handler. Full error is always logged server-side; the
// client only ever gets a generic message in production so stack traces,
// SQL error text, or file paths never leak to the browser.
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.message && err.message.includes('รองรับเฉพาะไฟล์รูปภาพ')) {
    return res.status(400).json({ error: err.message }); // known, safe-to-show validation message
  }
  const message = isProd ? 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่' : err.message;
  res.status(err.status || 500).json({ error: message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
