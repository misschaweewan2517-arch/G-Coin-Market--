// ===== Config =====
// ตรวจจับ URL อัตโนมัติ: ถ้าออนไลน์บน Production ให้ชี้ไปที่ Render ถ้าอยู่บน เครื่องตัวเอง (localhost) ให้ชี้ไปที่ port 4000
const RENDER_BACKEND_URL = 'https://g-coin-market--chuue-khaayeelkepliyneela-vvpu.onrender.com';
const LOCAL_BACKEND_URL = 'http://localhost:4000';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BASE_HOST = isLocalhost ? LOCAL_BACKEND_URL : RENDER_BACKEND_URL;

const API_BASE = window.API_BASE || `${BASE_HOST}/api`;
const IMG_BASE = API_BASE.replace(/\/api\/?$/, ''); // e.g. https://g-coin-market...onrender.com

// Omise's PUBLIC key only (never the secret key) — safe to expose in frontend
// code. Set this the same way as API_BASE when deploying: a small inline
// <script> before js/app.js sets window.OMISE_PUBLIC_KEY before this runs.
const OMISE_PUBLIC_KEY = window.OMISE_PUBLIC_KEY || '';

// ===== Auth/session helpers (persisted so refresh/close doesn't log the user out) =====
const Session = {
  get token() { return localStorage.getItem('gm_token'); },
  set token(v) { v ? localStorage.setItem('gm_token', v) : localStorage.removeItem('gm_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('gm_user') || 'null'); } catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('gm_user', JSON.stringify(v)) : localStorage.removeItem('gm_user'); },
  clear() { this.token = null; this.user = null; },
};

// ===== API client =====
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (Session.token) headers['Authorization'] = `Bearer ${Session.token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || `เกิดข้อผิดพลาด (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// ===== Toasts =====
function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}
function toast(message, type = 'success') {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ===== Loading overlay with progress bar =====
function ensureOverlay() {
  let el = document.querySelector('.overlay');
  if (!el) {
    el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `
      <div class="spinner"></div>
      <div class="progress-track"><div class="progress-fill"></div></div>
      <div class="overlay-label">กำลังดำเนินการ...</div>
    `;
    document.body.appendChild(el);
  }
  return el;
}
function showOverlay(label = 'กำลังดำเนินการ...') {
  const el = ensureOverlay();
  el.querySelector('.overlay-label').textContent = label;
  setProgress(0);
  el.classList.add('show');
}
function setProgress(pct) {
  const el = ensureOverlay();
  el.querySelector('.progress-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideOverlay() {
  ensureOverlay().classList.remove('show');
}

// ===== Nav rendering (shared across pages) =====
function renderNav() {
  const mount = document.getElementById('nav-mount');
  if (!mount) return;
  const user = Session.user;
  const path = location.pathname.split('/').pop();

  const link = (href, label) =>
    `<a href="${href}" class="${path === href ? 'active' : ''}">${label}</a>`;

  mount.innerHTML = `
    <div class="topnav-inner">
      <a href="index.html" class="brand" style="text-decoration:none;">
        <span class="brand-mark"></span> G-Coin Market
      </a>
      <nav class="nav-links">
        ${link('index.html', 'ตลาดสินค้า')}
        ${user ? link('sell.html', 'ลงขายสินค้า') : ''}
        ${user ? link('account.html', 'บัญชีของฉัน') : ''}
        ${user && user.role === 'admin' ? link('admin.html', 'แอดมิน') : ''}
      </nav>
      <div class="nav-right">
        ${
          user
            ? `<div class="coin-pill"><span class="dot"></span> ${(user.balance_real + user.balance_bonus).toLocaleString()} G</div>
               ${user.role === 'admin' ? '<span class="badge-admin">ADMIN</span>' : ''}
               <button class="btn btn-sm btn-ghost" id="nav-logout">ออกจากระบบ</button>`
            : `<a href="login.html" class="btn btn-sm btn-ghost">เข้าสู่ระบบ</a>
               <a href="register.html" class="btn btn-sm btn-primary">สมัครสมาชิก</a>`
        }
      </div>
    </div>
  `;

  const logoutBtn = document.getElementById('nav-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      Session.clear();
      location.href = 'index.html';
    });
  }
}

async function refreshSessionUser() {
  if (!Session.token) return null;
  try {
    const { user } = await api('/auth/me');
    Session.user = user;
    return user;
  } catch {
    Session.clear();
    return null;
  }
}

function requireLogin(redirectTo = 'login.html') {
  if (!Session.token) {
    location.href = redirectTo;
    return false;
  }
  return true;
}

function requireAdminPage() {
  if (!requireLogin()) return false;
  if (!Session.user || Session.user.role !== 'admin') {
    location.href = 'index.html';
    return false;
  }
  return true;
}

// Category display metadata used across pages
const CATEGORY_META = {
  roblox: { label: 'Roblox', color: 'var(--cat-roblox)' },
  rov: { label: 'RoV', color: 'var(--cat-rov)' },
  valorant: { label: 'Valorant', color: 'var(--cat-valorant)' },
  mlbb: { label: 'MLBB', color: 'var(--cat-mlbb)' },
};

function statusBadge(status) {
  const map = {
    pending: 'รอดำเนินการ', completed: 'สำเร็จ', rejected: 'ปฏิเสธ',
    active: 'กำลังขาย', sold: 'ขายแล้ว', removed: 'ถอนออก',
  };
  return `<span class="status-badge status-${status}">${map[status] || status}</span>`;
}

// Escapes any user-supplied text before it's inserted via innerHTML, anywhere
// in the app (listing titles, bank details, admin reasons, etc. are all
// attacker-controllable strings from someone's point of view — never trust
// them unescaped in HTML).
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ===== SweetAlert2 wrappers (liquid-glass themed) — used for important confirmations =====
function swalSuccess(title, text) {
  if (typeof Swal === 'undefined') return toast(title, 'success');
  return Swal.fire({
    icon: 'success', title, text,
    confirmButtonText: 'ตกลง',
    background: 'transparent',
    customClass: { popup: 'swal-glass-popup', title: 'swal-glass-title', confirmButton: 'swal-glass-confirm' },
  });
}
function swalError(title, text) {
  if (typeof Swal === 'undefined') return toast(title, 'error');
  return Swal.fire({
    icon: 'error', title, text,
    confirmButtonText: 'ปิด',
    background: 'transparent',
    customClass: { popup: 'swal-glass-popup', title: 'swal-glass-title', confirmButton: 'swal-glass-confirm' },
  });
}
function swalConfirm(title, text, confirmText = 'ยืนยัน') {
  if (typeof Swal === 'undefined') return Promise.resolve(confirm(title));
  return Swal.fire({
    icon: 'question', title, text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'ยกเลิก',
    background: 'transparent',
    customClass: {
      popup: 'swal-glass-popup', title: 'swal-glass-title',
      confirmButton: 'swal-glass-confirm', cancelButton: 'swal-glass-cancel',
    },
  }).then((r) => r.isConfirmed);
}

document.addEventListener('DOMContentLoaded', renderNav);
