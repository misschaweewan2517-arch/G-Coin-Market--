const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Purchase a listing. Runs as a single synchronous better-sqlite3 transaction,
// so the balance check and the deduction happen atomically with no window for
// a double-spend from concurrent requests.
router.post('/', requireAuth, (req, res) => {
  const { listing_id } = req.body || {};

  const purchase = db.transaction(() => {
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listing_id);
    if (!listing) throw { status: 404, message: 'ไม่พบสินค้านี้' };
    if (listing.status !== 'active') throw { status: 409, message: 'สินค้านี้ถูกขายหรือถอนออกไปแล้ว' };
    if (listing.seller_id === req.user.id) throw { status: 400, message: 'ไม่สามารถซื้อสินค้าของตัวเองได้' };

    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const totalAvailable = buyer.balance_real + buyer.balance_bonus;
    if (totalAvailable < listing.price) {
      throw { status: 402, message: 'ยอดเหรียญ G-Coins ไม่เพียงพอ กรุณาเติมเงินก่อนทำรายการ' };
    }

    // Spend bonus (unbacked) coins first, then real coins for the remainder.
    const spendFromBonus = Math.min(buyer.balance_bonus, listing.price);
    const spendFromReal = listing.price - spendFromBonus;

    db.prepare('UPDATE users SET balance_real = balance_real - ?, balance_bonus = balance_bonus - ? WHERE id = ?')
      .run(spendFromReal, spendFromBonus, buyer.id);

    // The taint carries through: whatever fraction of the buyer's payment was
    // unbacked bonus coin becomes unbacked bonus coin for the seller too. This
    // is what stops admin-minted coins from ever being laundered into a real
    // withdrawal via a fake sale.
    db.prepare('UPDATE users SET balance_real = balance_real + ?, balance_bonus = balance_bonus + ? WHERE id = ?')
      .run(spendFromReal, spendFromBonus, listing.seller_id);

    db.prepare(`UPDATE listings SET status = 'sold' WHERE id = ?`).run(listing.id);

    const order = db
      .prepare(
        `INSERT INTO orders (listing_id, buyer_id, seller_id, price, spent_from_real, spent_from_bonus)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(listing.id, buyer.id, listing.seller_id, listing.price, spendFromReal, spendFromBonus);

    db.prepare(
      `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
       VALUES (?, 'purchase', ?, ?, 'order', ?, ?)`
    ).run(buyer.id, -spendFromReal, -spendFromBonus, order.lastInsertRowid, `ซื้อสินค้า: ${listing.title}`);

    db.prepare(
      `INSERT INTO ledger (user_id, type, amount_real, amount_bonus, ref_type, ref_id, note)
       VALUES (?, 'sale', ?, ?, 'order', ?, ?)`
    ).run(listing.seller_id, spendFromReal, spendFromBonus, order.lastInsertRowid, `ขายสินค้า: ${listing.title}`);

    return order.lastInsertRowid;
  });

  try {
    const orderId = purchase();
    res.status(201).json({ order_id: orderId });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่' });
  }
});

router.get('/mine', requireAuth, (req, res) => {
  // ดึงรายการที่ซื้อ (เพิ่ม listings.id AS listing_id เพื่อให้ปุ่มดูรหัสผ่านฝั่ง Frontend ใช้งานได้)
  const bought = db
    .prepare(
      `SELECT orders.*, listings.title, listings.category, listings.id AS listing_id 
       FROM orders
       JOIN listings ON listings.id = orders.listing_id
       WHERE orders.buyer_id = ? ORDER BY orders.id DESC`
    )
    .all(req.user.id);

  const sold = db
    .prepare(
      `SELECT orders.*, listings.title, listings.category, listings.id AS listing_id 
       FROM orders
       JOIN listings ON listings.id = orders.listing_id
       WHERE orders.seller_id = ? ORDER BY orders.id DESC`
    )
    .all(req.user.id);

  res.json({ bought, sold });
});

module.exports = router;
