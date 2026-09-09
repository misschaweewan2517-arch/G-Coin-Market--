const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encryptSecret, decryptSecret } = require('../crypto');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const okExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(okExt && okMime ? null : new Error('รองรับเฉพาะไฟล์รูปภาพ .jpg .jpeg .png .webp'), okExt && okMime);
  },
});

function publicListing(row, { includeOwnerCheck } = {}) {
  return {
    id: row.id,
    seller_id: row.seller_id,
    seller_username: row.seller_username,
    title: row.title,
    category: row.category,
    price: row.price,
    description: row.description,
    images: JSON.parse(row.images || '[]'),
    status: row.status,
    created_at: row.created_at,
  };
}

const CATEGORIES = ['roblox', 'rov', 'valorant', 'mlbb'];

router.get('/categories', (req, res) => res.json({ categories: CATEGORIES }));

// Public browse + filter
router.get('/', (req, res) => {
  const { category, q, min_price, max_price } = req.query;
  let sql = `SELECT listings.*, users.username as seller_username
             FROM listings JOIN users ON users.id = listings.seller_id
             WHERE listings.status = 'active'`;
  const params = [];

  if (category && CATEGORIES.includes(category)) {
    sql += ' AND listings.category = ?';
    params.push(category);
  }
  if (q) {
    sql += ' AND listings.title LIKE ?';
    params.push(`%${q}%`);
  }
  if (min_price) {
    sql += ' AND listings.price >= ?';
    params.push(Number(min_price));
  }
  if (max_price) {
    sql += ' AND listings.price <= ?';
    params.push(Number(max_price));
  }
  sql += ' ORDER BY listings.created_at DESC LIMIT 100';

  const rows = db.prepare(sql).all(...params);
  res.json({ listings: rows.map((r) => publicListing(r)) });
});

// All of the current user's own listings, regardless of status (active/sold/removed).
router.get('/mine/all', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT listings.*, users.username as seller_username FROM listings
       JOIN users ON users.id = listings.seller_id
       WHERE listings.seller_id = ? ORDER BY listings.created_at DESC`
    )
    .all(req.user.id);
  res.json({ listings: rows.map((r) => publicListing(r)) });
});

router.get('/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT listings.*, users.username as seller_username FROM listings
       JOIN users ON users.id = listings.seller_id WHERE listings.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบสินค้านี้' });
  res.json({ listing: publicListing(row) });
});

router.post('/', requireAuth, upload.array('images', 6), (req, res) => {
  const { title, category, price, description, secret_username, secret_password, secret_notes } = req.body || {};

  if (!title || !CATEGORIES.includes(category) || !price || Number(price) <= 0) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อสินค้า หมวดหมู่ และราคาให้ถูกต้อง' });
  }
  if (title.length > 120 || (description || '').length > 4000) {
    return res.status(400).json({ error: 'ชื่อสินค้าหรือรายละเอียดยาวเกินไป' });
  }
  if (!secret_username && !secret_password && !secret_notes) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลบัญชี/รหัสสำหรับส่งมอบให้ผู้ซื้อ' });
  }

  const images = (req.files || []).map((f) => `/uploads/${f.filename}`);
  const secretPlain = [
    secret_username ? `Username: ${secret_username}` : '',
    secret_password ? `Password: ${secret_password}` : '',
    secret_notes ? `Notes: ${secret_notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const info = db
    .prepare(
      `INSERT INTO listings (seller_id, title, category, price, description, images, secret_ciphertext)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, title, category, Math.round(Number(price)), description || '', JSON.stringify(images), encryptSecret(secretPlain));

  res.status(201).json({ listing_id: info.lastInsertRowid });
});

router.delete('/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'ไม่พบสินค้านี้' });
  if (listing.seller_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบสินค้านี้' });
  }
  db.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// Reveal the secret credentials — only for the seller, the buyer of a completed
// order for this listing, or an admin.
router.get('/:id/secret', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'ไม่พบสินค้านี้' });

  const isSeller = listing.seller_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const hasBoughtIt = db
    .prepare(`SELECT id FROM orders WHERE listing_id = ? AND buyer_id = ? AND status = 'completed'`)
    .get(req.params.id, req.user.id);

  if (!isSeller && !isAdmin && !hasBoughtIt) {
    return res.status(403).json({ error: 'ต้องซื้อสินค้านี้ก่อนจึงจะดูข้อมูลบัญชีได้' });
  }
  res.json({ secret: decryptSecret(listing.secret_ciphertext) });
});

module.exports = router;
