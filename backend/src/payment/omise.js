// Minimal Omise (https://www.omise.co) REST client using Node's built-in fetch.
// Omise is the standard PromptPay/card gateway for Thai businesses; swap this
// file out if you pick a different provider (2C2P, GB Prime Pay, Stripe for
// international cards, etc.) — the shape (createCharge / getCharge) is what
// routes/wallet.js relies on, so keep that contract if you change providers.
//
// IMPORTANT: real money only ever flows once you (a) sign a merchant
// agreement with Omise (requires business registration / KYC — this is a
// legal requirement, not something any code can skip), and (b) put your real
// OMISE_SECRET_KEY / OMISE_PUBLIC_KEY into .env. Until then these calls will
// fail with a clear "not configured" error rather than silently pretending
// to succeed.

const OMISE_API = 'https://api.omise.co';

function getSecretKey() {
  const key = process.env.OMISE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'OMISE_SECRET_KEY ยังไม่ถูกตั้งค่าใน .env — สมัครบัญชี Omise และนำ secret key จริงมาใส่ก่อนใช้งานเติมเงินจริง'
    );
  }
  return key;
}

function authHeader() {
  // Omise uses HTTP Basic auth with the secret key as the username and an
  // empty password.
  return 'Basic ' + Buffer.from(`${getSecretKey()}:`).toString('base64');
}

async function omiseFetch(path, options = {}) {
  const res = await fetch(`${OMISE_API}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.message || `Omise API error (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// amountThb: whole baht (we convert to satang — Omise's smallest unit — x100).
// Creates a PromptPay charge and returns the scannable QR code image URL.
async function createPromptPayCharge(amountThb, description) {
  const source = await omiseFetch('/sources', {
    method: 'POST',
    body: new URLSearchParams({
      type: 'promptpay',
      amount: String(Math.round(amountThb * 100)),
      currency: 'thb',
    }),
  });

  const charge = await omiseFetch('/charges', {
    method: 'POST',
    body: new URLSearchParams({
      amount: String(Math.round(amountThb * 100)),
      currency: 'thb',
      source: source.id,
      description: description || 'G-Coin Market deposit',
    }),
  });

  return {
    chargeId: charge.id,
    status: charge.status, // 'pending' until the customer scans + pays
    qrImageUrl: charge.source?.scannable_code?.image?.download_uri || null,
  };
}

// tokenId comes from Omise.js running in the browser (card number never
// touches your server — required for PCI compliance). See frontend account.html.
async function createCardCharge(amountThb, tokenId, description) {
  const charge = await omiseFetch('/charges', {
    method: 'POST',
    body: new URLSearchParams({
      amount: String(Math.round(amountThb * 100)),
      currency: 'thb',
      card: tokenId,
      description: description || 'G-Coin Market deposit',
    }),
  });
  return { chargeId: charge.id, status: charge.status };
}

// The one function the webhook handler trusts: always re-fetch the charge
// directly from Omise's API by ID rather than trusting whatever a webhook
// payload claims, since a webhook POST body can be spoofed by anyone who
// knows (or guesses) your endpoint URL.
async function getCharge(chargeId) {
  return omiseFetch(`/charges/${encodeURIComponent(chargeId)}`);
}

module.exports = { createPromptPayCharge, createCardCharge, getCharge };
