// Sends the actual OTP codes used by the "forgot password" flow.
//
// EMAIL is wired up for real via SMTP (nodemailer) — fill in SMTP_* in .env
// and it works with Gmail (with an App Password), Outlook, or any transactional
// email provider (Resend, Brevo, SendGrid, Mailgun, AWS SES, etc. all give you
// SMTP credentials too).
//
// SMS is left as a clearly-marked integration point: sending real SMS costs
// money per message and requires signing up with a provider (in Thailand:
// Twilio, Vonage, Thaibulk SMS, DeeSMS, THSMS, or your own carrier deal).
// There's no free/generic way to "just send a real text message" — you must
// pick a provider, get an API key, and drop it into sendSms() below. Until
// you do, phone-based OTP will throw a clear error instead of pretending to
// send something it didn't.

const nodemailer = requireOptional('nodemailer');

function requireOptional(name) {
  try { return require(name); } catch { return null; }
}

let cachedTransport = null;
function getTransport() {
  if (cachedTransport) return cachedTransport;
  if (!nodemailer) {
    throw new Error(
      'nodemailer ยังไม่ถูกติดตั้ง — รันคำสั่ง: npm install nodemailer'
    );
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า SMTP_HOST / SMTP_USER / SMTP_PASS ใน .env — ระบบส่งอีเมล OTP จึงยังใช้งานไม่ได้'
    );
  }
  cachedTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return cachedTransport;
}

async function sendOtpEmail(toEmail, code) {
  const transport = getTransport();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: `รหัสยืนยัน G-Coin Market: ${code}`,
    text: `รหัสยืนยันของคุณคือ ${code} (หมดอายุใน 10 นาที) หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
    html: `<p>รหัสยืนยันของคุณคือ:</p><h2 style="letter-spacing:4px">${code}</h2><p>รหัสนี้หมดอายุใน 10 นาที หากคุณไม่ได้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>`,
  });
}

// --- SMS integration point -------------------------------------------------
// Below is a ready-to-fill Twilio example (uncomment + npm install twilio).
// Swap the body of this function for whichever Thai SMS provider you choose;
// the shape (accept a phone + code, throw on failure) stays the same.
async function sendOtpSms(toPhone, code) {
  const twilio = requireOptional('twilio');
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;

  if (!twilio || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    throw new Error(
      'ระบบส่ง SMS OTP ยังไม่ถูกตั้งค่า — ต้องสมัครผู้ให้บริการ SMS จริง (เช่น Twilio, ' +
      'Thaibulk SMS, DeeSMS) แล้วใส่ค่า TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / ' +
      'TWILIO_FROM_NUMBER ใน .env และรัน "npm install twilio" (หรือแก้ sendOtpSms() ' +
      'ใน backend/src/notify.js ให้เรียก API ของผู้ให้บริการที่คุณเลือก)'
    );
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  await client.messages.create({
    to: toPhone,
    from: TWILIO_FROM_NUMBER,
    body: `รหัสยืนยัน G-Coin Market ของคุณคือ ${code} (หมดอายุใน 10 นาที)`,
  });
}

// Unified entry point used by the auth routes.
async function sendOtp(channel, destination, code) {
  if (channel === 'email') return sendOtpEmail(destination, code);
  if (channel === 'phone') return sendOtpSms(destination, code);
  throw new Error('ช่องทางส่งรหัสไม่ถูกต้อง');
}

module.exports = { sendOtp };
