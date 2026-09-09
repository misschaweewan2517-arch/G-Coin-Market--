const rateLimit = require('express-rate-limit');

// Generous limit for normal browsing/API use.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'มีการเรียกใช้งานถี่เกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// Tight limit on login/register to slow down brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามเข้าสู่ระบบ/สมัครสมาชิกถี่เกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// Tighter still on money-moving endpoints (deposit, withdrawal, purchase).
const moneyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ทำธุรกรรมถี่เกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// Very tight limit on OTP request/verify endpoints. This matters even more
// than login rate limiting: every triggered SMS costs real money, and a
// 6-digit code is brute-forceable if an attacker gets unlimited guesses.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ขอ/ยืนยันรหัส OTP ถี่เกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

module.exports = { apiLimiter, authLimiter, moneyLimiter, otpLimiter };
