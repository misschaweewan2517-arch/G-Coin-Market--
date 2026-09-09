const express = require('express');
const db = require('../db');
const omise = require('../payment/omise');

const router = express.Router();

// Omise POSTs an event notification here whenever a charge's status changes.
// Classic Omise webhooks are NOT cryptographically signed, so the payload
// itself is untrustworthy — anyone who finds this URL could POST a fake
// "charge.complete" body. The safe pattern (and what Omise's own docs
// recommend) is: ignore what the payload *claims*, take only the charge ID
// out of it, then ask Omise's API directly "what is the real status of this
// charge?" using our secret key. Only that answer is trusted.
//
// For extra hardening in production, also restrict this route at your
// reverse proxy / firewall to Omise's published webhook IP ranges (see
// https://www.omise.co/webhooks-guide) — defense in depth on top of the
// re-verification below.
router.post('/omise', async (req, res) => {
  // Always 200 quickly so Omise doesn't endlessly retry; do the real work
  // before responding since it's fast (one DB transaction + one API call).
  try {
    const chargeId = req.body?.data?.id || req.body?.data?.object?.id;
    if (!chargeId) return res.status(200).json({ ok: true });

    const charge = await omise.getCharge(chargeId); // <- the trusted source of truth
    if (charge.status !== 'successful') return res.status(200).json({ ok: true });

    const dep = db.prepare('SELECT * FROM deposits WHERE gateway_charge_id = ?').get(chargeId);
    if (!dep) return res.status(200).json({ ok: true }); // unknown charge, ignore
    if (dep.status === 'completed') return res.status(200).json({ ok: true }); // already processed (idempotent)

    db.transaction(() => {
      db.prepare(`UPDATE deposits SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(dep.id);
      db.prepare('UPDATE users SET balance_real = balance_real + ? WHERE id = ?').run(dep.amount, dep.user_id);
      db.prepare(
        `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
         VALUES (?, 'deposit', ?, 0, 'deposit', ?, ?)`
      ).run(dep.user_id, dep.amount, dep.id, `เติมเงินผ่าน ${dep.method} (ยืนยันจริงผ่าน Omise)`);
    })();

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook/omise]', err);
    res.status(200).json({ ok: true }); // never make Omise retry forever on our bug
  }
});

module.exports = router;
