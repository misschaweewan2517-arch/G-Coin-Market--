const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  bank_name TEXT,
  bank_account_number TEXT,
  promptpay_id TEXT,
  balance_real INTEGER NOT NULL DEFAULT 0,   -- G-Coins backed by real deposits/sales (withdrawable)
  balance_bonus INTEGER NOT NULL DEFAULT 0,  -- G-Coins from admin adjustments (spendable in-app only)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('roblox','rov','valorant','mlbb')),
  price INTEGER NOT NULL CHECK(price > 0),
  description TEXT,
  images TEXT NOT NULL DEFAULT '[]',      -- JSON array of image URLs/paths
  secret_ciphertext TEXT NOT NULL,        -- encrypted account username/password, AES-256-GCM
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','removed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  price INTEGER NOT NULL,
  spent_from_real INTEGER NOT NULL,
  spent_from_bonus INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','refunded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full transaction ledger. Every balance change anywhere in the system writes a row here.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('deposit','purchase','sale','withdrawal_hold','withdrawal_reject_refund','admin_mint','admin_deduct')),
  amount_real INTEGER NOT NULL DEFAULT 0,
  amount_bonus INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT,      -- 'order' | 'withdrawal' | 'deposit' | 'admin_action'
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Withdrawals can only ever be paid out of balance_real, never balance_bonus.
-- This is the safeguard that replaces the "mint coins -> cash out" pathway.
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  coin_amount INTEGER NOT NULL CHECK(coin_amount > 0),
  fee_percent REAL NOT NULL,
  fee_thb REAL NOT NULL,
  payout_thb REAL NOT NULL,
  bank_name TEXT,
  bank_account_number TEXT,
  promptpay_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
  processed_by INTEGER REFERENCES users(id),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every admin balance adjustment ("mint"/"deduct") is logged here permanently and
-- can never be deleted or edited by the admin who created it.
CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('mint','deduct','approve_withdrawal','reject_withdrawal')),
  target_user_id INTEGER REFERENCES users(id),
  amount INTEGER,
  reason TEXT NOT NULL,
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One-time codes for "forgot password" (and can be reused for future
-- registration verification). The code itself is never stored in plaintext —
-- only a SHA-256 hash of it — so a leaked database still can't be used to
-- reset anyone's password. Codes expire quickly and can only be used once.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK(channel IN ('email','phone')),
  destination TEXT NOT NULL,        -- the email/phone the code was sent to (for auditing)
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Real-money deposits. A row starts 'pending' the moment we ask the payment
-- gateway to create a charge, and can ONLY be flipped to 'completed' by the
-- webhook handler after independently re-confirming the charge status with
-- the gateway's API — never by a direct client call. See routes/wallet.js.
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL CHECK(method IN ('promptpay','credit_card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
  gateway_charge_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
`);

// ---- Lightweight migrations for databases created before this update ----
// (ALTER TABLE ... ADD COLUMN has no "IF NOT EXISTS" in SQLite, so we check
// PRAGMA table_info first. Safe to run every boot.)
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[migrate] Added ${table}.${column}`);
  }
}
ensureColumn('users', 'email', 'email TEXT');
ensureColumn('users', 'phone', 'phone TEXT');
ensureColumn('deposits', 'gateway_charge_id', 'gateway_charge_id TEXT');
ensureColumn('deposits', 'completed_at', 'completed_at TEXT');
// Old simulated-deposit rows were inserted with status 'completed' directly;
// that's fine to leave as history. New rows now default to 'pending'.

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_gateway_charge_id ON deposits(gateway_charge_id) WHERE gateway_charge_id IS NOT NULL;
`);

// Bootstrap a first admin account if none exists yet, from env vars.
function bootstrapAdmin() {
  const existing = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (existing) return;

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'changeme_on_first_login';
  const hash = bcrypt.hashSync(password, 12);

  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`
  ).run(username, hash);

  console.log(`[bootstrap] Created initial admin account "${username}".`);
  console.log('[bootstrap] Log in and change this password immediately — it is set from .env in plain text.');
}

bootstrapAdmin();

module.exports = db;
