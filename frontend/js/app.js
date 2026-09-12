// ===== Config =====
// ล็อกให้ชี้ไปที่ Render Backend โดยตรง
const RENDER_BACKEND_URL = 'https://g-coin-market-chuue-khaayeelkepliiyneela-vvpu.onrender.com';

const API_BASE = `${RENDER_BACKEND_URL}/api`;
const IMG_BASE = RENDER_BACKEND_URL;

// ใส่ Omise Public Key (pkey_test_...) ตรงนี้เพื่อใช้งาน Omise JS ใน Frontend
const OMISE_PUBLIC_KEY = window.OMISE_PUBLIC_KEY || 'pkey_test_xxxxxxxxxxxxxxxxxxxx';

// ===== Auth/session helpers =====
const Session = {
  get token() { return localStorage.getItem('gm_token'); },
  set token(v) { v ? localStorage.setItem('gm_token', v) : localStorage.removeItem('gm_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('gm_user') || 'null'); } catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('gm_user', JSON.stringify(v)) : localStorage.removeItem('gm_user'); },
  clear() { localStorage.removeItem('gm_token'); localStorage.removeItem('gm_user'); },
};

// ===== API client =====
async function api(path, { method = 'GET', body, isForm = false, headers: customHeaders = {} } = {}) {
  const headers = { ...customHeaders };
  if (Session.token) headers['Authorization'] = `Bearer ${Session.token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${API_BASE}${cleanPath}`;

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* กรณีไร้ body */ }

    if (!res.ok) {
      const message = (data && (data.message || data.error)) || `เกิดข้อผิดพลาด (${res.status})`;
      throw new Error(message);
    }
    return data;
  } catch (err) {
    if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
      throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ (กำลังปลุกเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้งใน 20 วินาที)');
    }
    throw err;
  }
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

// ===== Nav rendering =====
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
            ? `<div class="coin-pill"><span class="dot"></span> ${((user.balance_real || 0) + (user.balance_bonus || 0)).toLocaleString()} G</div>
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

// Category display metadata
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ===== SweetAlert2 wrappers =====
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

// ===== PROMPTPAY DEPOSIT & POLLING HELPER (เพิ่มใหม่) =====
let depositPollInterval = null;

async function startPromptPayDeposit(amount) {
  if (!amount || amount < 10) {
    return swalError('ข้อผิดพลาด', 'ยอดเติมเงินขั้นต่ำคือ 10 บาท');
  }

  showOverlay('กำลังสร้าง QR Code...');
  try {
    // 1. ส่ง request ขอ QR Code ไปที่ Backend
    const data = await api('/wallet/deposit/create', {
      method: 'POST',
      body: { amount: parseFloat(amount), method: 'promptpay' },
    });
    hideOverlay();

    if (!data.qr_image_url || !data.deposit_id) {
      throw new Error('ไม่สามารถดึงข้อมูล QR Code ได้');
    }

    // 2. แสดง Modal แสดง QR Code ด้วย SweetAlert2
    Swal.fire({
      title: 'สแกนเพื่อชำระเงิน',
      html: `
        <p style="margin-bottom:12px;">ยอดชำระ: <b>${amount} บาท</b></p>
        <div style="background:#fff; padding:15px; border-radius:12px; display:inline-block;">
          <img src="${data.qr_image_url}" alt="PromptPay QR Code" style="width:220px; height:220px; display:block;" />
        </div>
        <p style="margin-top:12px; font-size:13px; color:#aaa;">ระบบจะตรวจสอบการชำระเงินอัตโนมัติ กรุณาอย่าเพิ่งปิดหน้าต่างนี้</p>
      `,
      showConfirmButton: false,
      showCloseButton: true,
      allowOutsideClick: false,
      willClose: () => {
        if (depositPollInterval) clearInterval(depositPollInterval);
      }
    });

    // 3. เริ่มทำ Polling วนเช็กสถานะการจ่ายเงินทุกๆ 3 วินาที
    if (depositPollInterval) clearInterval(depositPollInterval);
    depositPollInterval = setInterval(async () => {
      try {
        const res = await api(`/wallet/deposit/${data.deposit_id}/status`);
        if (res.status === 'completed') {
          clearInterval(depositPollInterval);
          Swal.close();
          await refreshSessionUser();
          renderNav();
          swalSuccess('เติมเงินสำเร็จ!', `ได้รับ ${amount} G-Coins เรียบร้อยแล้ว`);
          if (typeof loadAccountData === 'function') loadAccountData(); // โหลดหน้าบัญชีใหม่ถ้าอยู่ในหน้า account.html
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);

  } catch (err) {
    hideOverlay();
    swalError('เกิดข้อผิดพลาด', err.message);
  }
}

document.addEventListener('DOMContentLoaded', renderNav);
