import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as cfg from "./config.js";
import { parseBulk } from "./bulk-parse.js";

// =====================================================================
// ค่าคงที่และ state
// =====================================================================
const { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } = cfg;
// ชื่อ Edge Function (ถ้า slug ไม่ใช่ manage-user ให้ใส่ FUNCTION_NAME ใน config.js)
const FUNCTION_NAME = cfg.FUNCTION_NAME || "manage-user";

const ROLE_TH = { owner: "เจ้าของเว็บ", supervisor: "ผู้ดูแล", admin: "แอดมิน", member: "สมาชิก" };
const RANK = { member: 1, admin: 2, supervisor: 3, owner: 4 };
const STATUS_TH = {
  pending: "รอโอน", transferred: "โอนแล้ว", confirmed: "ยืนยันแล้ว",
  returned: "ส่งกลับแก้ไข", cancelled: "ยกเลิก",
};
const PCOLS =
  "id,line_id,customer_id,bank_account_id,account_name,account_number,bank_code,customer_line_name," +
  "amount,note,status,version,return_reason,created_by,created_at,transferred_by,transferred_at," +
  "confirmed_at,returned_at,returned_by," +
  "creator:profiles!payout_requests_created_by_fkey(display_name)," +
  "transferrer:profiles!payout_requests_transferred_by_fkey(display_name)";

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = { me: null, lines: [], banks: [], bankMap: {}, lineFilter: "", timer: null, renderId: 0 };
const app = document.getElementById("app");

// =====================================================================
// HTML helpers (ทุกค่าที่ใส่ใน html`` ถูก escape อัตโนมัติ กัน XSS)
// =====================================================================
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("")
  : v === false || v == null ? "" : esc(v);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}

// =====================================================================
// Icons (เส้น 1.8px)
// =====================================================================
const svg = (d, s = 20) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const ICON = {
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  my: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  queue: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  report: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v3M16 3v3M8 14h3M8 17h6"/>',
  users: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.5 0 2.8.4 3.9 1.1"/><circle cx="18" cy="17" r="2.2"/><path d="M18 13v1.6M18 19.4V21M21.5 17h-1.3M15.8 17h-1.3"/>',
  lines: '<path d="M6 3v18M6 8c0 3 3 4 6 4s6 1 6 4v5"/><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14.5 8.5l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  mark: '<path d="M4 7h16v12H4z" stroke="none" fill="none"/><path d="M5 9.5 12 5l7 4.5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16"/>',
};
const BRAND = html`<span class="brand-mark">${svg(ICON.mark, 20)}</span>`;

// =====================================================================
// Format helpers
// =====================================================================
const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const baht = (n) => html`${money(n)}<small>บาท</small>`;
const acctFmt = (n) => /^\d{10}$/.test(n || "") ? `${n.slice(0, 3)}-${n.slice(3, 4)}-${n.slice(4, 9)}-${n.slice(9)}` : (n || "");
const digits = (s) => String(s || "").replace(/\D/g, "");
const dtFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
const shortDayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
const thaiDate = (d) => shortDayFmt.format(new Date(d + "T12:00:00+07:00"));
const dayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const when = (ts) => ts ? dtFmt.format(new Date(ts)) : "";
const clock = (ts) => ts ? clockFmt.format(new Date(ts)) + " น." : "";
const todayBkk = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const shiftDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const bankName = (code) => state.bankMap[code] || code;
const lineName = (id) => state.lines.find((l) => l.id === id)?.name || "";
const isOwner = () => state.me?.role === "owner";
const rank = () => RANK[state.me?.role] || 0;
const ownerLine = () => (isOwner() && state.lineFilter) ? state.lineFilter : null;
const scope = (q) => { const l = ownerLine(); return l ? q.eq("line_id", l) : q; };
const initial = (name) => (name || "?").trim().charAt(0);

function errMsg(e) {
  if (!e) return "เกิดข้อผิดพลาด";
  const m = e.message || "";
  if (e.code === "23505" && m.includes("customers_unique_name")) return "ชื่อไลน์นี้มีในสายแล้ว";
  if (e.code === "23505" && m.includes("lines_name")) return "ชื่อสายนี้มีแล้ว";
  if (e.code === "23505") return "เลขบัญชีนี้ (ธนาคารเดียวกัน) มีในสายแล้ว";
  if (e.code === "42501") return "ไม่มีสิทธิ์ทำรายการนี้";
  return m || String(e);
}

function storage(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || "";
    localStorage.setItem(key, val);
  } catch { /* ไม่มี storage ก็ทำงานต่อได้ */ }
  return "";
}
function session(key, val) {
  try {
    if (val === undefined) return sessionStorage.getItem(key) || "";
    sessionStorage.setItem(key, val);
  } catch { /* ignore */ }
  return "";
}

// =====================================================================
// Toast & Modal
// =====================================================================
function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  document.getElementById("toast-root").appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 2800);
}

let modalOpen = false;
function openModal({ title, body, foot = "", onMount, wide = false }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = html`<div class="modal-backdrop"><div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h3>${title}</h3><button class="x" data-close aria-label="ปิด">×</button></div>
    <form class="modal-form" novalidate>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot}</div>
    </form></div></div>`.s;
  modalOpen = true;
  const backdrop = root.firstElementChild;
  const close = () => { root.innerHTML = ""; modalOpen = false; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) { e.preventDefault(); copyText(cp.dataset.copy, cp); return; }
    if (e.target === backdrop || e.target.closest("[data-close]")) { e.preventDefault(); close(); }
  });
  const form = backdrop.querySelector("form");
  onMount?.(form, close);
  form.querySelector("input:not([type=hidden]):not([type=checkbox]):not([readonly]), select, textarea")?.focus();
  return close;
}

// คัดลอกข้อความ (มีทางสำรองสำหรับเบราว์เซอร์ที่ไม่รองรับ clipboard API)
async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) return toast("คัดลอกไม่ได้ กรุณาจดเลขเอง", true);
  if (btn) {
    const label = btn.innerHTML;
    btn.classList.add("copied"); btn.textContent = "คัดลอกแล้ว";
    setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = label; }, 1600);
  }
}

// ปุ่ม submit ระหว่างทำงาน กันกดซ้ำ
async function busy(btn, fn) {
  if (btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "กำลังบันทึก…";
  try { await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

const alertBox = (kind, content) => html`<div class="alert alert-${kind}">${content}</div>`.s;

function confirmBox(title, message, okLabel, onOk, danger = false) {
  openModal({
    title,
    body: html`<p style="margin:0">${message}</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ไม่ใช่ตอนนี้</button>
      <button type="submit" class="btn ${danger ? "btn-danger" : "btn-primary"}">${okLabel}</button>`,
    onMount: (form, close) => {
      form.onsubmit = (e) => {
        e.preventDefault();
        busy(form.querySelector("[type=submit]"), async () => { if (await onOk()) close(); });
      };
    },
  });
}

// =====================================================================
// Shared UI pieces
// =====================================================================
const stamp = (s) => html`<span class="stamp st-${s}">${STATUS_TH[s] || s}</span>`;
const holderName = (n) => n ? n : html`<span class="no-name">ไม่ระบุชื่อบัญชี</span>`;
const acctLine = (a) => html`<div class="acct"><span class="bank">${bankName(a.bank_code)}</span>
  <span class="num">${acctFmt(a.account_number)}</span><span class="holder">${holderName(a.account_name)}</span></div>`;
const bankOptions = (selected = "") => state.banks.map((b) =>
  html`<option value="${b.code}" ${b.code === selected ? raw("selected") : ""}>${b.name_th}</option>`);
const lineOptions = (selected = "") => state.lines.map((l) =>
  html`<option value="${l.id}" ${l.id === selected ? raw("selected") : ""}>${l.name}</option>`);
const meta = (...items) => html`<div class="meta">${items.filter(Boolean).map((t) => html`<span>${t}</span>`)}</div>`;

function payoutEntry(p, actions = "", { link = true } = {}) {
  return html`<div class="entry">
    <div class="entry-main">
      <div class="entry-title">${link
        ? html`<a href="#/c/${p.customer_id}">${p.customer_line_name}</a>` : p.customer_line_name} ${stamp(p.status)}</div>
      ${acctLine(p)}
      ${meta(
        p.creator?.display_name && `ส่งโดย ${p.creator.display_name}`,
        when(p.created_at),
        p.transferrer?.display_name && `โอนโดย ${p.transferrer.display_name} เวลา ${clock(p.transferred_at)}`,
        isOwner() && !ownerLine() && lineName(p.line_id),
      )}
      ${p.note ? html`<div class="note">${p.note}</div>` : ""}
      ${p.status === "returned" ? html`<div class="reason">${returnText(p)}</div>` : ""}
    </div>
    <div class="entry-side">
      <div class="amount">${baht(p.amount)}</div>
      ${actions ? html`<div class="entry-actions">${actions}</div>` : ""}
    </div>
  </div>`;
}

const isRecalled = (p) => p.returned_by && p.returned_by === p.created_by;
const returnText = (p) => isRecalled(p) ? "ดึงกลับมาแก้ไข ยังไม่ได้ส่งใหม่"
  : `ถูกส่งกลับ${p.return_reason ? `: ${p.return_reason}` : " (ไม่ระบุเหตุผล)"}`;

// สลิปโอนเงิน: แสดงแค่ 3 อย่างที่ต้องใช้ตอนโอน + ยอดเงิน
const slip = (p) => html`<div class="slip">
  <div class="slip-row"><span class="k">ชื่อไลน์</span><span class="v">${p.customer_line_name}</span></div>
  <div class="slip-row"><span class="k">ชื่อบัญชี</span><span class="v">${p.account_name || html`<span class="no-name">ไม่ระบุ ตรวจชื่อในแอปธนาคารก่อนโอน</span>`}</span></div>
  <div class="slip-row"><span class="k">ธนาคาร</span><span class="v">${bankName(p.bank_code)}</span></div>
  <div class="slip-row slip-row-acct"><span class="k">เลขบัญชี</span>
    <span class="v"><span class="slip-acct">${acctFmt(p.account_number)}</span>
      <button type="button" class="copy-btn" data-copy="${p.account_number}" aria-label="คัดลอกเลขบัญชี">${svg(ICON.copy, 16)}คัดลอก</button></span></div>
  <div class="slip-amount"><span class="k">ยอดเงิน</span><span class="v">${money(p.amount)}<small>บาท</small></span></div>
  ${p.note ? html`<div class="slip-note">หมายเหตุ: ${p.note}</div>` : ""}
</div>`;

const emptyBox = (title, sub = "") => html`<div class="empty"><b>${title}</b>${sub}</div>`;

function showError(el, e) { el.innerHTML = alertBox("danger", errMsg(e)); }

// =====================================================================
// Auth
// =====================================================================
async function loadMe() {
  const { data: { session: s } } = await sb.auth.getSession();
  if (!s) { state.me = null; return; }
  const { data: me } = await sb.from("profiles")
    .select("id,username,display_name,role,line_id,is_active").eq("id", s.user.id).maybeSingle();
  if (!me || !me.is_active) {
    await sb.auth.signOut();
    state.me = null;
    toast("บัญชีนี้ถูกระงับหรือไม่พบโปรไฟล์", true);
    return;
  }
  state.me = me;
  const [banks, lines] = await Promise.all([
    sb.from("banks").select("code,name_th").order("sort"),
    sb.from("lines").select("id,name").order("name"),
  ]);
  state.banks = banks.data || [];
  state.bankMap = Object.fromEntries(state.banks.map((b) => [b.code, b.name_th]));
  state.lines = lines.data || [];
  state.lineFilter = isOwner() ? storage("lineFilter") : "";
  if (state.lineFilter && !state.lines.some((l) => l.id === state.lineFilter)) state.lineFilter = "";
}

function viewLogin() {
  app.innerHTML = html`<div class="login-wrap"><form class="login" id="login" novalidate>
    ${BRAND}
    <h1>ระบบรายการจ่ายเงิน</h1>
    <p>เข้าสู่ระบบด้วย username ที่ได้รับจากผู้ดูแล</p>
    <div id="login-err"></div>
    <div class="field"><label for="u">Username</label>
      <input type="text" id="u" name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    <div class="field"><label for="p">รหัสผ่าน</label>
      <input type="password" id="p" name="p" autocomplete="current-password" required></div>
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:6px" type="submit">เข้าสู่ระบบ</button>
  </form></div>`.s;
  const form = app.querySelector("#login");
  form.u.focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    const username = form.u.value.trim().toLowerCase();
    const password = form.p.value;
    const errBox = form.querySelector("#login-err");
    if (!username || !password) { errBox.innerHTML = alertBox("danger", "กรอก username และรหัสผ่านให้ครบ"); return; }
    busy(form.querySelector("[type=submit]"), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: `${username}@${EMAIL_DOMAIN}`, password });
      if (error) {
        errBox.innerHTML = alertBox("danger", /banned/i.test(error.message) ? "บัญชีนี้ถูกระงับ ติดต่อผู้ดูแลของสาย" : "username หรือรหัสผ่านไม่ถูกต้อง");
        return;
      }
      await loadMe();
      route();
    });
  };
}

// =====================================================================
// Shell + router
// =====================================================================
const NAV = [
  ["customers", "ลูกค้า", 1],
  ["my", "รายการของฉัน", 1],
  ["queue", "คิวโอน", 2],
  ["report", "รายงานรายวัน", 2],
  ["users", "ผู้ใช้", 3],
  ["lines", "สาย", 4],
];
const NAV_SHORT = { customers: "ลูกค้า", my: "ของฉัน", queue: "คิวโอน", report: "รายงาน", users: "ผู้ใช้", lines: "สาย" };

function parseRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "customers", id };
}

function renderShell(current) {
  const me = state.me;
  const items = NAV.filter(([, , r]) => rank() >= r);
  const isActive = (k) => current === k || (k === "customers" && current === "c");
  const lineSelect = (id) => html`<select id="${id}" aria-label="เลือกสาย">
    <option value="">ทุกสาย</option>${lineOptions(state.lineFilter)}</select>`;
  const scopeName = isOwner() ? "ดูได้ทุกสาย" : lineName(me.line_id);

  app.innerHTML = html`
  <div class="layout">
    <aside class="side">
      <div class="brand">${BRAND}<div><div class="brand-name">รายการจ่ายเงิน</div>
        <div class="brand-line">${scopeName}</div></div></div>
      ${isOwner() ? html`<div class="line-pick"><label for="line-filter">กำลังดู</label>${lineSelect("line-filter")}</div>` : ""}
      <nav class="side-nav">${items.map(([k, label]) => html`
        <a href="#/${k}" class="${isActive(k) ? "active" : ""}">${svg(ICON[k])}<span>${label}</span>${
          k === "queue" ? raw('<span class="count" data-queue-count hidden></span>') : ""}</a>`)}</nav>
      <div class="side-user">
        <span class="avatar">${initial(me.display_name)}</span>
        <div class="who"><b>${me.display_name}</b><span>${ROLE_TH[me.role]}</span></div>
        <button class="icon-btn" data-passwd title="เปลี่ยนรหัสผ่าน" aria-label="เปลี่ยนรหัสผ่าน">${svg(ICON.key)}</button>
        <button class="icon-btn" data-logout title="ออกจากระบบ" aria-label="ออกจากระบบ">${svg(ICON.logout)}</button>
      </div>
    </aside>

    <div>
      <header class="mobile-top">${BRAND}
        <div class="t">${me.display_name}<span>${ROLE_TH[me.role]}${me.line_id ? ` ${lineName(me.line_id)}` : ""}</span></div>
        ${isOwner() ? lineSelect("line-filter-m") : ""}
        <button class="icon-btn" data-passwd aria-label="เปลี่ยนรหัสผ่าน">${svg(ICON.key)}</button>
        <button class="icon-btn" data-logout aria-label="ออกจากระบบ">${svg(ICON.logout)}</button>
      </header>
      <main id="view" class="main"></main>
    </div>
  </div>
  <nav class="tabbar">${items.map(([k]) => html`
    <a href="#/${k}" class="${isActive(k) ? "active" : ""}">${svg(ICON[k], 22)}<span>${NAV_SHORT[k]}</span>${
      k === "queue" ? raw('<span class="count" data-queue-count hidden></span>') : ""}</a>`)}</nav>`.s;

  app.querySelectorAll("[data-logout]").forEach((b) => {
    b.onclick = async () => { await sb.auth.signOut(); state.me = null; location.hash = ""; route(); };
  });
  app.querySelectorAll("[data-passwd]").forEach((b) => { b.onclick = () => changeOwnPasswordModal(); });
  app.querySelectorAll("#line-filter, #line-filter-m").forEach((sel) => {
    sel.onchange = () => { state.lineFilter = sel.value; storage("lineFilter", sel.value); route(); };
  });
  if (rank() >= 2) refreshQueueCount();
}

// เปลี่ยนรหัสผ่านของตัวเอง (ทุกบทบาท) ต้องยืนยันรหัสผ่านเดิมก่อน
function changeOwnPasswordModal() {
  openModal({
    title: "เปลี่ยนรหัสผ่านของฉัน",
    body: html`<div id="msg"></div>
      <div class="field"><label for="pw-cur">รหัสผ่านปัจจุบัน</label>
        <input id="pw-cur" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">รหัสผ่านใหม่</label>
        <input id="pw-new" type="password" name="next" autocomplete="new-password" required>
        <span class="hint">อย่างน้อย 8 ตัวอักษร</span></div>
      <div class="field"><label for="pw-again">ยืนยันรหัสผ่านใหม่</label>
        <input id="pw-again" type="password" name="again" autocomplete="new-password" required></div>
      <label class="check-line show-pw"><input type="checkbox" name="show"><span>แสดงรหัสผ่านที่พิมพ์</span></label>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary">เปลี่ยนรหัสผ่าน</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.show.onchange = () => {
        for (const n of ["current", "next", "again"]) form[n].type = form.show.checked ? "text" : "password";
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const cur = form.current.value, next = form.next.value, again = form.again.value;
        if (!cur) return (msg.innerHTML = alertBox("danger", "กรอกรหัสผ่านปัจจุบัน"));
        if (next.length < 8) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร"));
        if (next !== again) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"));
        if (next === cur) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"));
        busy(form.querySelector("[type=submit]"), async () => {
          // ยืนยันว่าเป็นเจ้าของบัญชีจริง ด้วยการเข้าสู่ระบบด้วยรหัสผ่านเดิม
          const { error: authErr } = await sb.auth.signInWithPassword({
            email: `${state.me.username}@${EMAIL_DOMAIN}`, password: cur,
          });
          if (authErr) { msg.innerHTML = alertBox("danger", "รหัสผ่านปัจจุบันไม่ถูกต้อง"); return; }
          const { error } = await sb.auth.updateUser({ password: next });
          if (error) {
            const m = /different from the old|same/i.test(error.message) ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"
              : /weak|least/i.test(error.message) ? "รหัสผ่านใหม่ง่ายเกินไป ลองใช้ตัวอักษรผสมตัวเลข" : error.message;
            msg.innerHTML = alertBox("danger", m);
            return;
          }
          close();
          toast("เปลี่ยนรหัสผ่านแล้ว ใช้รหัสใหม่ในการเข้าสู่ระบบครั้งถัดไป");
        });
      };
    },
  });
}

async function refreshQueueCount() {
  const { count } = await scope(sb.from("payout_requests").select("id", { count: "exact", head: true }).eq("status", "pending"));
  document.querySelectorAll("[data-queue-count]").forEach((el) => { el.textContent = count || ""; el.hidden = !count; });
}

const VIEWS = {
  customers: [1, viewCustomers],
  c: [1, viewCustomer],
  my: [1, viewMy],
  queue: [2, viewQueue],
  report: [2, viewReport],
  users: [3, viewUsers],
  lines: [4, viewLines],
};

function route() {
  clearInterval(state.timer);
  document.getElementById("modal-root").innerHTML = "";
  modalOpen = false;
  if (!configured) {
    app.innerHTML = html`<div class="login-wrap"><div class="login">${BRAND}<h1>ยังไม่ได้ตั้งค่า</h1>
      <p>ใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ในไฟล์ config.js แล้วโหลดหน้านี้ใหม่</p></div></div>`.s;
    return;
  }
  if (!state.me) return viewLogin();
  const r = parseRoute();
  let entry = VIEWS[r.name];
  if (!entry || rank() < entry[0]) { r.name = "customers"; entry = VIEWS.customers; }
  renderShell(r.name);
  const view = document.getElementById("view");
  const id = ++state.renderId;
  window.scrollTo(0, 0);
  entry[1](view, r.id, () => id === state.renderId).catch((e) => showError(view, e));
}

// =====================================================================
// หน้า: ลูกค้า (ค้นหา + เพิ่ม)
// =====================================================================
async function viewCustomers(v, _id, alive) {
  v.innerHTML = html`
  <div class="page-head"><h1>ลูกค้า</h1>
    <button class="btn" id="bulk">${svg(ICON.paste, 18)}วางหลายราย</button>
    <button class="btn btn-primary" id="add">${svg(ICON.plus, 18)}เพิ่มลูกค้า</button></div>
  <div class="search-row">
    <label class="search">${svg(ICON.search)}
      <input type="search" id="q" placeholder="ค้นหาด้วยชื่อไลน์ ชื่อบัญชี หรือเลขบัญชี" autocomplete="off" aria-label="ค้นหาลูกค้า"></label>
    ${isOwner() ? html`<select id="q-line" class="search-line" aria-label="ค้นหาในสาย">
      <option value="">ทุกสาย</option>${lineOptions(state.lineFilter)}</select>` : ""}
  </div>
  <div id="results"></div>`.s;

  const q = v.querySelector("#q");
  const res = v.querySelector("#results");
  q.value = session("custQ");
  let seq = 0, t;
  const run = async () => {
    const my = ++seq;
    session("custQ", q.value);
    const { data, error } = await sb.rpc("search_customers", { p_q: q.value, p_line_id: ownerLine() });
    if (my !== seq || !alive()) return;
    if (error) return showError(res, error);
    res.innerHTML = data.length ? html`<div class="cgrid">${data.map((c) => html`
      <a class="ccard" href="#/c/${c.id}">
        <span class="ccard-avatar">${initial(c.line_name)}</span>
        <div class="ccard-name">${c.line_name}</div>
        ${isOwner() && !ownerLine() ? html`<div class="ccard-line">${c.line_title}</div>` : ""}
        <div class="ccard-accts">${c.accounts.length ? c.accounts.map((a) => html`
          <div class="ccard-acct"><span class="bank">${bankName(a.bank_code)}</span>
            <span class="num">${acctFmt(a.account_number)}</span>
            <span class="holder">${holderName(a.account_name)}</span></div>`) : html`<div class="meta">ยังไม่มีบัญชี</div>`}</div>
      </a>`)}</div>`.s
      : (q.value ? emptyBox("ไม่พบลูกค้าที่ตรงกับคำค้น", "ลองค้นด้วยเลขบัญชีบางส่วน หรือกดเพิ่มลูกค้า")
        : emptyBox("ยังไม่มีลูกค้าในสาย", "กดเพิ่มลูกค้าเพื่อบันทึกบัญชีแรก")).s;
  };
  q.oninput = () => { clearTimeout(t); t = setTimeout(run, 250); };
  // เลือกสาย (เฉพาะเจ้าของเว็บ): ใช้ค่าเดียวกับตัวเลือกสายในเมนู
  const qLine = v.querySelector("#q-line");
  if (qLine) qLine.onchange = () => {
    state.lineFilter = qLine.value;
    storage("lineFilter", qLine.value);
    document.querySelectorAll("#line-filter, #line-filter-m").forEach((sel) => { sel.value = qLine.value; });
    if (rank() >= 2) refreshQueueCount();
    run();
  };
  q.focus();
  v.querySelector("#add").onclick = () => addCustomerModal(q.value);
  v.querySelector("#bulk").onclick = () => bulkPasteModal();
  await run();
}

// เช็คว่าเลขบัญชีนี้มีในสายแล้วหรือยัง คืนค่าบัญชีที่ซ้ำ (ถ้ามี)
async function findDuplicateAccount(lineId, bank, number, exceptId = null) {
  let q = sb.from("bank_accounts").select("id,customer_id,account_name,customers(line_name)")
    .eq("line_id", lineId).eq("bank_code", bank).eq("account_number", number);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.maybeSingle();
  return data;
}

// เช็คชื่อไลน์ซ้ำในสาย (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย)
async function findDuplicateName(lineId, name, exceptId = null) {
  const { data } = await sb.from("customers").select("id,line_name").eq("line_id", lineId).limit(1000);
  const key = name.trim().toLowerCase();
  return (data || []).find((c) => c.id !== exceptId && c.line_name.trim().toLowerCase() === key);
}

const dupAccountAlert = (d) => alertBox("warn", html`เลขบัญชีนี้มีอยู่แล้ว เป็นของลูกค้า
  <a href="#/c/${d.customer_id}">${d.customers?.line_name}</a> ${d.account_name ? `(ชื่อบัญชี ${d.account_name})` : ""}`);
const dupNameAlert = (c) => alertBox("warn", html`มีลูกค้าชื่อไลน์ <a href="#/c/${c.id}">${c.line_name}</a> ในสายแล้ว
  บันทึกซ้ำไม่ได้ ถ้าเป็นคนเดียวกัน ให้เข้าไปเพิ่มบัญชีที่ลูกค้าคนนั้น`);

const bankAndNumberFields = (a = {}) => html`<div class="row">
  <div class="field"><label for="f-bank">ธนาคาร</label>
    <select id="f-bank" name="bank_code" required><option value="">เลือกธนาคาร</option>${bankOptions(a.bank_code)}</select></div>
  <div class="field"><label for="f-num">เลขบัญชี</label>
    <input id="f-num" class="input-num" type="text" name="account_number" inputmode="numeric" value="${a.account_number || ""}" required
      placeholder="ตัวเลขเท่านั้น"></div>
</div>`;

const accountNameField = (value = "") => html`<div class="field"><label for="f-holder">ชื่อบัญชีธนาคาร <span class="opt">(ไม่บังคับ)</span></label>
  <input id="f-holder" type="text" name="account_name" value="${value || ""}" placeholder="ถ้าลูกค้าไม่ได้ให้มา เว้นว่างได้"></div>`;

function readAccount(form, fixedName = null) {
  const a = {
    account_name: (fixedName ?? form.account_name.value.trim()) || null,
    bank_code: form.bank_code.value,
    account_number: digits(form.account_number.value),
  };
  if (!a.bank_code) return [null, "เลือกธนาคาร"];
  if (!/^\d{6,20}$/.test(a.account_number)) return [null, "เลขบัญชีต้องเป็นตัวเลข 6–20 หลัก"];
  return [a, null];
}

function addCustomerModal(prefill = "") {
  const pickLine = isOwner();
  const looksLikeNumber = /^\d[\d\s-]{5,}$/.test(prefill.trim());
  openModal({
    title: "เพิ่มลูกค้า",
    body: html`<div id="msg"></div>
      ${pickLine ? html`<div class="field"><label for="f-line">สาย</label>
        <select id="f-line" name="line_id" required><option value="">เลือกสาย</option>${lineOptions(state.lineFilter)}</select></div>` : ""}
      <div class="field"><label for="f-line-name">ชื่อไลน์ลูกค้า</label>
        <input id="f-line-name" type="text" name="line_name" value="${looksLikeNumber ? "" : prefill}" required></div>
      ${accountNameField()}
      ${bankAndNumberFields(looksLikeNumber ? { account_number: digits(prefill) } : {})}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary">บันทึกลูกค้า</button>`,
    onMount: (form) => {
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const lineId = pickLine ? form.line_id.value : state.me.line_id;
        const lineNameV = form.line_name.value.trim();
        const [acct, err] = readAccount(form);
        if (pickLine && !lineId) return (msg.innerHTML = alertBox("danger", "เลือกสายก่อน"));
        if (!lineNameV) return (msg.innerHTML = alertBox("danger", "ใส่ชื่อไลน์ลูกค้า"));
        if (err) return (msg.innerHTML = alertBox("danger", err));
        busy(form.querySelector("[type=submit]"), async () => {
          const sameName = await findDuplicateName(lineId, lineNameV);
          if (sameName) { msg.innerHTML = dupNameAlert(sameName); return; }
          const dup = await findDuplicateAccount(lineId, acct.bank_code, acct.account_number);
          if (dup) { msg.innerHTML = dupAccountAlert(dup); return; }
          const { data: id, error } = await sb.rpc("create_customer", {
            p_line_id: lineId, p_line_name: lineNameV, p_account_name: acct.account_name,
            p_account_number: acct.account_number, p_bank_code: acct.bank_code,
          });
          if (error) { msg.innerHTML = alertBox("danger", errMsg(error)); return; }
          toast("บันทึกลูกค้าแล้ว");
          location.hash = `#/c/${id}`;
        });
      };
    },
  });
}

// =====================================================================
// เพิ่มลูกค้าหลายรายจากข้อความที่ก๊อปมาจากไลน์
//   ชื่อไลน์ใหม่                 -> สร้างลูกค้าใหม่
//   ชื่อไลน์เดิม + บัญชีใหม่      -> เพิ่มบัญชีให้ลูกค้าเดิม
//   ชื่อไลน์เดิม + บัญชีเดิม      -> ข้าม
//   เลขบัญชีเป็นของลูกค้าคนอื่น   -> ข้าม
// =====================================================================
const normName = (n) => String(n || "").trim().toLowerCase();
const BULK_KIND = {
  new: ["st-confirmed", "ลูกค้าใหม่"],
  add: ["st-transferred", "เพิ่มบัญชี"],
  skip: ["st-cancelled", "ข้าม"],
  fix: ["st-returned", "ต้องแก้"],
};

function bulkPasteModal(prefillText = "", prefillLine = "") {
  const pickLine = isOwner();
  openModal({
    title: "เพิ่มลูกค้าหลายราย",
    wide: true,
    body: html`<div id="msg"></div>
      ${pickLine ? html`<div class="field"><label for="b-line">สาย</label>
        <select id="b-line" name="line_id"><option value="">เลือกสาย</option>${lineOptions(prefillLine || state.lineFilter)}</select></div>` : ""}
      <div class="field"><label for="b-text">วางข้อความจากไลน์</label>
        <textarea id="b-text" name="text" rows="12" class="bulk-text" placeholder="@ชื่อไลน์&#10;1234567890&#10;กสิกร&#10;นายสมชาย ใจดี&#10;&#10;@ลูกค้าคนต่อไป&#10;..."></textarea>
        <span class="hint">วางได้หลายรายในครั้งเดียว เว้นบรรทัดระหว่างลูกค้า หรือขึ้นต้นแต่ละรายด้วย @ ระบบจะแยกให้ แล้วให้ตรวจก่อนบันทึก</span></div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary">แยกข้อมูล</button>`,
    onMount: (form) => {
      form.text.value = prefillText;
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const lineId = pickLine ? form.line_id.value : state.me.line_id;
        if (!lineId) return (msg.innerHTML = alertBox("danger", "เลือกสายก่อน"));
        const items = parseBulk(form.text.value);
        if (!items.length) return (msg.innerHTML = alertBox("danger", "ไม่พบข้อมูลลูกค้าในข้อความ ตรวจว่ามีชื่อไลน์หรือเลขบัญชี"));
        const text = form.text.value;
        busy(form.querySelector("[type=submit]"), async () => {
          const index = await loadLineIndex(lineId);
          if (!index) { msg.innerHTML = alertBox("danger", "โหลดข้อมูลลูกค้าในสายไม่สำเร็จ ลองอีกครั้ง"); return; }
          bulkReviewModal(lineId, items, index, text);
        });
      };
    },
  });
}

// ลูกค้าและบัญชีทั้งหมดในสาย ใช้เช็คซ้ำ
async function loadLineIndex(lineId) {
  const { data, error } = await sb.from("customers")
    .select("id,line_name,bank_accounts(account_number,bank_code,account_name)").eq("line_id", lineId).limit(10000);
  if (error) return null;
  const byName = new Map(), byAcct = new Map();
  for (const c of data) {
    const holder = c.bank_accounts.find((a) => a.account_name)?.account_name || "";
    byName.set(normName(c.line_name), { id: c.id, name: c.line_name, holder });
    for (const a of c.bank_accounts) byAcct.set(`${a.bank_code}:${a.account_number}`, { name: c.line_name, norm: normName(c.line_name) });
  }
  return { byName, byAcct };
}

// ตัดสินว่าแต่ละรายจะทำอะไร (ไล่ตามลำดับ รายการก่อนหน้าในชุดเดียวกันมีผลกับรายการถัดไป)
function evaluateBulk(items, index) {
  const names = new Map(index.byName);
  const accts = new Map(index.byAcct);
  for (const it of items) {
    if (it.removed) continue;
    const name = it.line_name.trim(), norm = normName(name);
    const num = digits(it.account_number);
    if (!name) { it.kind = "fix"; it.msg = "ใส่ชื่อไลน์"; continue; }
    if (!it.bank_code) { it.kind = "fix"; it.msg = "เลือกธนาคาร"; continue; }
    if (!/^\d{6,20}$/.test(num)) { it.kind = "fix"; it.msg = "เลขบัญชีต้องเป็นตัวเลข 6–20 หลัก"; continue; }
    const key = `${it.bank_code}:${num}`;
    const owner = accts.get(key);
    if (owner) {
      it.kind = "skip";
      it.msg = owner.batch ? "ซ้ำกับรายการก่อนหน้าในชุดนี้"
        : owner.norm === norm ? "ลูกค้าคนนี้มีบัญชีนี้อยู่แล้ว" : `เลขบัญชีนี้เป็นของลูกค้า ${owner.name}`;
      continue;
    }
    const cust = names.get(norm);
    if (cust) {
      it.kind = "add";
      it.msg = `ชื่อไลน์ ${cust.name} มีอยู่แล้ว จะเพิ่มบัญชีนี้ให้ลูกค้าคนเดิม`;
    } else {
      it.kind = "new";
      it.msg = "สร้างลูกค้าใหม่";
      names.set(norm, { id: null, name, holder: it.account_name.trim(), batch: true });
    }
    accts.set(key, { name, norm, batch: true });
  }
}

function bulkReviewModal(lineId, items, index, sourceText) {
  items.forEach((it, i) => {
    it.i = i; it.removed = false;
    if (it.bank_code && !state.bankMap[it.bank_code]) it.bank_code = ""; // ธนาคารที่ไม่มีในรายการ ให้เลือกเอง
  });
  const card = (it) => html`<div class="bulk-item" data-i="${it.i}">
    <div class="bulk-head"><span class="stamp" data-stamp></span><span class="bulk-msg" data-msg></span>
      <button type="button" class="x x-sm" data-remove aria-label="ไม่บันทึกรายนี้">×</button></div>
    <div class="bulk-fields">
      <div class="field"><label>ชื่อไลน์</label><input type="text" data-f="line_name" value="${it.line_name}"></div>
      <div class="field"><label>ธนาคาร</label><select data-f="bank_code"><option value="">เลือกธนาคาร</option>${bankOptions(it.bank_code)}</select></div>
      <div class="field"><label>เลขบัญชี</label><input type="text" class="input-num" inputmode="numeric" data-f="account_number" value="${it.account_number}"></div>
      <div class="field"><label>ชื่อบัญชี <span class="opt">(ไม่บังคับ)</span></label><input type="text" data-f="account_name" value="${it.account_name}"></div>
    </div>
    ${it.notes.length ? html`<div class="bulk-notes">${it.notes.join(" ")}</div>` : ""}
    <details class="bulk-raw"><summary>ข้อความเดิม</summary><pre>${it.raw}</pre></details>
  </div>`;

  openModal({
    title: "ตรวจข้อมูลก่อนบันทึก",
    wide: true,
    body: html`<div id="msg"></div>
      ${isOwner() ? html`<div class="bulk-line">บันทึกเข้า <b>${lineName(lineId)}</b></div>` : ""}
      <div class="bulk-summary" id="b-sum"></div>
      <div class="bulk-list">${items.map(card)}</div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-act="back">แก้ข้อความ</button>
      <button type="submit" class="btn btn-primary" id="b-save">บันทึก</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      const save = form.querySelector("#b-save");
      const refresh = () => {
        evaluateBulk(items, index);
        for (const it of items) {
          const el = form.querySelector(`.bulk-item[data-i="${it.i}"]`);
          el.classList.toggle("removed", it.removed);
          const st = el.querySelector("[data-stamp]");
          const [cls, label] = it.removed ? ["st-cancelled", "ไม่บันทึก"] : BULK_KIND[it.kind];
          st.className = `stamp ${cls}`; st.textContent = label;
          el.querySelector("[data-msg]").textContent = it.removed ? "กด ↺ เพื่อนำกลับมา" : it.msg;
          el.querySelector("[data-remove]").textContent = it.removed ? "↺" : "×";
        }
        const live = items.filter((x) => !x.removed);
        const count = (k) => live.filter((x) => x.kind === k).length;
        const ready = count("new") + count("add");
        form.querySelector("#b-sum").innerHTML = html`
          <span class="chip chip-new">ลูกค้าใหม่ ${count("new")}</span>
          <span class="chip chip-add">เพิ่มบัญชี ${count("add")}</span>
          <span class="chip chip-skip">ข้าม ${count("skip")}</span>
          ${count("fix") ? html`<span class="chip chip-fix">ต้องแก้ ${count("fix")}</span>` : ""}`.s;
        save.textContent = ready ? `บันทึก ${ready} ราย` : "ไม่มีรายการที่บันทึกได้";
        save.disabled = !ready || count("fix") > 0;
        save.title = count("fix") ? "แก้รายการที่ขึ้นว่าต้องแก้ หรือกด × ไม่บันทึกรายนั้น" : "";
      };
      form.addEventListener("input", (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const it = items[Number(e.target.closest(".bulk-item").dataset.i)];
        it[f] = e.target.value;
        refresh();
      });
      form.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-remove]");
        if (rm) { const it = items[Number(rm.closest(".bulk-item").dataset.i)]; it.removed = !it.removed; refresh(); }
        if (e.target.closest("[data-act=back]")) { close(); bulkPasteModal(sourceText, lineId); }
      });
      refresh();
      form.onsubmit = (e) => {
        e.preventDefault();
        refresh();
        if (save.disabled) return;
        busy(save, async () => {
          const result = await saveBulk(lineId, items.filter((x) => !x.removed), index);
          close();
          bulkResultModal(result);
        });
      };
    },
  });
}

async function saveBulk(lineId, items, index) {
  const ids = new Map([...index.byName].map(([k, v]) => [k, { id: v.id, holder: v.holder }]));
  const done = { created: 0, added: 0, skipped: [], failed: [] };
  for (const it of items) {
    const name = it.line_name.trim(), norm = normName(name);
    const num = digits(it.account_number);
    const holder = it.account_name.trim();
    if (it.kind === "skip") { done.skipped.push({ name, msg: it.msg }); continue; }
    const known = ids.get(norm);
    if (!known) {
      const { data: id, error } = await sb.rpc("create_customer", {
        p_line_id: lineId, p_line_name: name, p_account_name: holder || null,
        p_account_number: num, p_bank_code: it.bank_code,
      });
      if (error) { done.failed.push({ name, msg: errMsg(error) }); continue; }
      ids.set(norm, { id, holder });
      done.created++;
    } else {
      const { error } = await sb.from("bank_accounts").insert({
        customer_id: known.id, line_id: lineId, account_name: holder || known.holder || null,
        account_number: num, bank_code: it.bank_code,
      });
      if (error) { done.failed.push({ name, msg: errMsg(error) }); continue; }
      if (!known.holder && holder) known.holder = holder;
      done.added++;
    }
  }
  return done;
}

function bulkResultModal(r) {
  const list = (rows) => html`<ul class="bulk-result">${rows.map((x) => html`<li><b>${x.name}</b> ${x.msg}</li>`)}</ul>`;
  openModal({
    title: "บันทึกเสร็จแล้ว",
    body: html`<div class="bulk-summary">
        <span class="chip chip-new">ลูกค้าใหม่ ${r.created}</span>
        <span class="chip chip-add">เพิ่มบัญชี ${r.added}</span>
        <span class="chip chip-skip">ข้าม ${r.skipped.length}</span>
        ${r.failed.length ? html`<span class="chip chip-fix">ไม่สำเร็จ ${r.failed.length}</span>` : ""}</div>
      ${r.failed.length ? html`<div class="section-head" style="margin-top:14px"><h2>ไม่สำเร็จ</h2></div>${list(r.failed)}` : ""}
      ${r.skipped.length ? html`<div class="section-head" style="margin-top:14px"><h2>ข้าม</h2></div>${list(r.skipped)}` : ""}`,
    foot: html`<button type="button" class="btn btn-primary" data-close>เสร็จแล้ว</button>`,
  });
  // โหลดรายชื่อลูกค้าใหม่ไว้ข้างหลัง
  const view = document.getElementById("view");
  if (view && parseRoute().name === "customers") viewCustomers(view, null, () => true).catch(() => {});
}

// =====================================================================
// หน้า: รายละเอียดลูกค้า
// =====================================================================
async function viewCustomer(v, id, alive) {
  const [cRes, aRes, pRes] = await Promise.all([
    sb.from("customers").select("id,line_id,line_name,created_at,creator:profiles!customers_created_by_fkey(display_name)")
      .eq("id", id).maybeSingle(),
    sb.from("bank_accounts").select("*").eq("customer_id", id).order("created_at"),
    sb.from("payout_requests").select(PCOLS).eq("customer_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!alive()) return;
  const c = cRes.data;
  if (!c) { v.innerHTML = emptyBox("ไม่พบลูกค้านี้", html`<a href="#/customers">กลับไปหน้าลูกค้า</a>`).s; return; }
  const accounts = aRes.data || [];
  const payouts = pRes.data || [];
  const holder = accounts.find((a) => a.account_name)?.account_name || "";

  v.innerHTML = html`
  <a class="back" href="#/customers">${svg(ICON.back, 16)}ลูกค้าทั้งหมด</a>
  <div class="page-head"><h1>${c.line_name}</h1>
    <button class="btn btn-sm" data-act="rename">แก้ชื่อไลน์</button>
    ${meta(isOwner() && lineName(c.line_id), c.creator?.display_name && `เพิ่มโดย ${c.creator.display_name}`, when(c.created_at))}
  </div>

  <div class="section-head"><h2>บัญชีธนาคาร</h2>
    <button class="btn btn-sm" data-act="add-acct" style="margin-left:auto">${svg(ICON.plus, 16)}เพิ่มบัญชี</button></div>
  ${accounts.length ? html`<div class="ledger">${accounts.map((a) => html`
    <div class="entry"><div class="entry-main">${acctLine(a)}</div>
      <div class="entry-actions">
        <button class="btn btn-sm btn-quiet" data-act="edit-acct" data-id="${a.id}">แก้ไข</button>
        <button class="btn btn-sm btn-primary" data-act="pay" data-id="${a.id}">สร้างรายการโอน</button>
      </div></div>`)}</div>` : emptyBox("ยังไม่มีบัญชี", "กดเพิ่มบัญชีเพื่อสร้างรายการโอน")}

  <div class="section-head"><h2>ประวัติรายการ</h2><span class="sum">${payouts.length ? `${payouts.length} รายการล่าสุด` : ""}</span></div>
  ${payouts.length ? html`<div class="ledger">${payouts.map((p) => payoutEntry(p, "", { link: false }))}</div>`
    : emptyBox("ยังไม่มีรายการโอน")}`.s;

  const reload = () => route();
  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const acct = accounts.find((a) => a.id === b.dataset.id);
    if (b.dataset.act === "rename") renameCustomerModal(c, reload);
    if (b.dataset.act === "add-acct") addAccountModal(c, holder, reload);
    if (b.dataset.act === "edit-acct") editAccountModal(c, acct, reload);
    if (b.dataset.act === "pay") createPayoutModal(c, acct);
  };
}

function renameCustomerModal(c, done) {
  openModal({
    title: "แก้ชื่อไลน์ลูกค้า",
    body: html`<div id="msg"></div><div class="field"><label for="f-rn">ชื่อไลน์ลูกค้า</label>
      <input id="f-rn" type="text" name="line_name" value="${c.line_name}" required></div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึกชื่อ</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.line_name.value.trim();
        if (!name) return;
        busy(form.querySelector("[type=submit]"), async () => {
          const same = await findDuplicateName(c.line_id, name, c.id);
          if (same) { msg.innerHTML = dupNameAlert(same); return; }
          const { error } = await sb.from("customers").update({ line_name: name }).eq("id", c.id);
          if (error) return (msg.innerHTML = alertBox("danger", errMsg(error)));
          close(); toast("บันทึกชื่อแล้ว"); done();
        });
      };
    },
  });
}

// เพิ่มบัญชีให้ลูกค้าเดิม: ชื่อบัญชีดึงจากบัญชีแรกของลูกค้า กรอกแค่ธนาคารกับเลขบัญชี
function addAccountModal(c, holder, done) {
  openModal({
    title: "เพิ่มบัญชีให้ " + c.line_name,
    body: html`<div id="msg"></div>
      ${holder ? html`<div class="field"><span class="label">ชื่อบัญชีธนาคาร</span>
        <div class="readonly-value">${holder}</div><span class="hint">ใช้ชื่อเดียวกับบัญชีเดิมของลูกค้า</span></div>`
        : accountNameField()}
      ${bankAndNumberFields()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">เพิ่มบัญชี</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const [a, err] = readAccount(form, holder || null);
        if (err) return (msg.innerHTML = alertBox("danger", err));
        busy(form.querySelector("[type=submit]"), async () => {
          const dup = await findDuplicateAccount(c.line_id, a.bank_code, a.account_number);
          if (dup) { msg.innerHTML = dupAccountAlert(dup); return; }
          const { error } = await sb.from("bank_accounts").insert({ ...a, customer_id: c.id, line_id: c.line_id });
          if (error) return (msg.innerHTML = alertBox("danger", errMsg(error)));
          close(); toast("เพิ่มบัญชีแล้ว"); done();
        });
      };
    },
  });
}

function editAccountModal(c, acct, done) {
  openModal({
    title: "แก้ไขบัญชี",
    body: html`<div id="msg"></div>${accountNameField(acct.account_name)}${bankAndNumberFields(acct)}
      <p class="small-print">รายการโอนที่ส่งไปแล้วยังใช้ข้อมูลบัญชีเดิม</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึกบัญชี</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const [a, err] = readAccount(form);
        if (err) return (msg.innerHTML = alertBox("danger", err));
        busy(form.querySelector("[type=submit]"), async () => {
          const dup = await findDuplicateAccount(c.line_id, a.bank_code, a.account_number, acct.id);
          if (dup) { msg.innerHTML = dupAccountAlert(dup); return; }
          const { error } = await sb.from("bank_accounts").update(a).eq("id", acct.id);
          if (error) return (msg.innerHTML = alertBox("danger", errMsg(error)));
          close(); toast("บันทึกบัญชีแล้ว"); done();
        });
      };
    },
  });
}

const amountFields = (value = "") => html`<div class="field"><label for="f-amt">ยอดเงิน (บาท)</label>
    <input id="f-amt" class="input-amount" type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${value}" required placeholder="0.00"></div>
  <div class="field"><label for="f-note">หมายเหตุ (ไม่บังคับ)</label><textarea id="f-note" name="note" maxlength="300"></textarea></div>`;

function readAmount(form) {
  const n = Math.round(Number(form.amount.value) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function createPayoutModal(c, acct) {
  openModal({
    title: "สร้างรายการโอน",
    body: html`<div id="msg"></div>
      <div class="mini-slip"><div class="k">โอนให้ ${c.line_name}</div>${acctLine(acct)}</div>
      ${amountFields()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">ส่งให้แอดมินโอน</button>`,
    onMount: (form, close) => {
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = readAmount(form);
        if (!amount) return (form.querySelector("#msg").innerHTML = alertBox("danger", "ใส่ยอดเงินมากกว่า 0"));
        busy(form.querySelector("[type=submit]"), async () => {
          const { error } = await sb.rpc("create_payout", { p_bank_account_id: acct.id, p_amount: amount, p_note: form.note.value });
          if (error) return (form.querySelector("#msg").innerHTML = alertBox("danger", errMsg(error)));
          close(); toast(`ส่งรายการ ${money(amount)} บาท ให้แอดมินแล้ว`); route();
        });
      };
    },
  });
}

// =====================================================================
// หน้า: รายการของฉัน
// =====================================================================
async function viewMy(v, _id, alive) {
  const tab = session("myTab") || "open";
  const TABS = [["open", "รอโอน"], ["returned", "ส่งกลับแก้ไข"], ["done", "โอนแล้ว"], ["cancelled", "ยกเลิก"], ["all", "ทั้งหมด"]];
  const { data, error } = await sb.from("payout_requests").select(PCOLS)
    .eq("created_by", state.me.id).order("created_at", { ascending: false }).limit(200);
  if (!alive()) return;
  if (error) return showError(v, error);

  const match = {
    open: (p) => p.status === "pending",
    returned: (p) => p.status === "returned",
    done: (p) => p.status === "transferred" || p.status === "confirmed",
    cancelled: (p) => p.status === "cancelled",
    all: () => true,
  };
  const rows = data.filter(match[tab]);
  const counts = Object.fromEntries(TABS.map(([k]) => [k, data.filter(match[k]).length]));

  v.innerHTML = html`
  <div class="page-head"><h1>รายการของฉัน</h1>
    <div class="page-meta"><span>รายการที่คุณส่ง 200 รายการล่าสุด</span></div></div>
  <div class="tabs" role="tablist">${TABS.map(([k, label]) => html`<button class="tab ${k === tab ? "active" : ""}" data-tab="${k}" role="tab">${label}${
    k !== "all" && counts[k] ? html`<span class="n">${counts[k]}</span>` : ""}</button>`)}</div>
  ${counts.returned && tab !== "returned" ? raw(alertBox("danger", html`มี ${counts.returned} รายการรอคุณแก้ไขแล้วส่งใหม่ <a href="#" data-tab="returned">ดูรายการ</a>`)) : ""}
  ${rows.length ? html`<div class="ledger">${rows.map((p) => payoutEntry(p,
      p.status === "pending" ? html`
        <button class="btn btn-sm btn-quiet btn-danger" data-act="cancel" data-id="${p.id}">ยกเลิก</button>
        <button class="btn btn-sm" data-act="recall" data-id="${p.id}">ดึงกลับมาแก้</button>`
      : p.status === "returned" ? html`
        <button class="btn btn-sm btn-quiet btn-danger" data-act="cancel" data-id="${p.id}">ยกเลิก</button>
        <button class="btn btn-sm btn-primary" data-act="edit" data-id="${p.id}">แก้แล้วส่งใหม่</button>` : ""))}</div>`
    : emptyBox("ไม่มีรายการในหมวดนี้")}`.s;

  v.onclick = (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { e.preventDefault(); session("myTab", t.dataset.tab); return route(); }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const p = data.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "edit") editPayoutModal(p);
    if (b.dataset.act === "recall") {
      busy(b, async () => {
        const { error: err } = await sb.rpc("recall_payout", { p_id: p.id });
        if (err) { toast(errMsg(err), true); return route(); }
        toast("ดึงกลับแล้ว แอดมินจะไม่เห็นรายการนี้จนกว่าคุณส่งใหม่");
        session("myTab", "returned");
        await route();
        editPayoutModal({ ...p, status: "returned", returned_by: state.me.id, created_by: state.me.id });
      });
    }
    if (b.dataset.act === "cancel") {
      confirmBox("ยกเลิกรายการนี้?", `${money(p.amount)} บาท ให้ ${p.customer_line_name} จะถูกยกเลิก และแอดมินจะไม่เห็นในคิวโอน`, "ยกเลิกรายการ", async () => {
        const { error: err } = await sb.rpc("cancel_payout", { p_id: p.id });
        if (err) { toast(errMsg(err), true); return false; }
        toast("ยกเลิกรายการแล้ว"); route(); return true;
      }, true);
    }
  };
}

async function editPayoutModal(p) {
  const { data: accounts } = await sb.from("bank_accounts").select("*").eq("customer_id", p.customer_id).order("created_at");
  const returned = p.status === "returned";
  openModal({
    title: returned ? "แก้แล้วส่งใหม่" : "แก้ไขรายการ",
    body: html`<div id="msg"></div>
      ${returned ? raw(alertBox(isRecalled(p) ? "info" : "danger", returnText(p))) : ""}
      <div class="field"><span class="label">ลูกค้า</span><div class="readonly-value">${p.customer_line_name}</div></div>
      <div class="field"><label for="f-acct">บัญชีที่จะโอน</label><select id="f-acct" name="acct">${(accounts || []).map((a) => html`
        <option value="${a.id}" ${a.id === p.bank_account_id ? raw("selected") : ""}>${bankName(a.bank_code)} ${acctFmt(a.account_number)} ${a.account_name || ""}</option>`)}</select></div>
      ${amountFields(p.amount)}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ปิด</button>
      <button type="submit" class="btn btn-primary">${returned ? "ส่งใหม่" : "บันทึกการแก้ไข"}</button>`,
    onMount: (form, close) => {
      form.note.value = p.note || "";
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = readAmount(form);
        if (!amount) return (form.querySelector("#msg").innerHTML = alertBox("danger", "ใส่ยอดเงินมากกว่า 0"));
        busy(form.querySelector("[type=submit]"), async () => {
          const { error } = await sb.rpc("edit_payout", { p_id: p.id, p_bank_account_id: form.acct.value, p_amount: amount, p_note: form.note.value });
          if (error) return (form.querySelector("#msg").innerHTML = alertBox("danger", errMsg(error)));
          close(); toast(returned ? "ส่งใหม่แล้ว" : "บันทึกการแก้ไขแล้ว"); route();
        });
      };
    },
  });
}

// =====================================================================
// หน้า: คิวโอน (แอดมินขึ้นไป)
// =====================================================================
async function viewQueue(v, _id, alive) {
  const [pend, trans] = await Promise.all([
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "pending")).order("created_at").limit(300),
    // รายการค้างจากระบบเดิม (โอนแล้วแต่ยังไม่ยืนยัน)
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "transferred")).order("transferred_at").limit(300),
  ]);
  if (!alive()) return;
  if (pend.error || trans.error) return showError(v, pend.error || trans.error);
  const pending = pend.data;
  const legacy = trans.data.filter((p) => p.transferred_by === state.me.id);
  const total = (rows) => money(rows.reduce((s, p) => s + Number(p.amount), 0));
  const sum = (rows) => html`<span class="sum">${rows.length} รายการ รวม <b>${total(rows)}</b> บาท</span>`;

  v.innerHTML = html`
  <div class="page-head"><h1>คิวโอน</h1>
    <button class="btn btn-sm" data-act="refresh">โหลดใหม่</button>
    <div class="page-meta"><span>อัปเดตเองทุก 20 วินาที</span></div></div>

  ${legacy.length ? html`
    <div class="section-head"><h2>ค้างยืนยันจากระบบเดิม</h2>${sum(legacy)}</div>
    <div class="ledger">${legacy.map((p) => payoutEntry(p, html`
      <button class="btn btn-primary" data-act="legacy" data-id="${p.id}">ยืนยันการโอน</button>`))}</div>` : ""}

  <div class="section-head"><h2>รอโอน</h2>${sum(pending)}</div>
  ${pending.length ? html`<div class="ledger">${pending.map((p) => payoutEntry(p, html`
      <button class="btn btn-sm btn-quiet btn-danger" data-act="return" data-id="${p.id}">ส่งกลับ</button>
      <button class="btn btn-primary" data-act="confirm" data-id="${p.id}">ยืนยันการโอน</button>`))}</div>`
    : emptyBox("ไม่มีรายการรอโอน", "รายการใหม่จากสมาชิกจะขึ้นที่นี่")}`.s;

  const all = [...pending, ...trans.data];
  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "refresh") return route();
    const p = all.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "confirm") confirmModal(p, "confirm_payout", { p_id: p.id, p_version: p.version });
    if (b.dataset.act === "legacy") confirmModal(p, "confirm_transfer", { p_id: p.id });
    if (b.dataset.act === "return") returnModal(p);
  };
  state.timer = setInterval(() => { if (!modalOpen && alive()) route(); }, 20000);
}

// ยืนยันการโอนขั้นตอนเดียว: ดูสลิป โอนในแอปธนาคาร ติ๊กว่าตรวจแล้ว กดยืนยัน
function confirmModal(p, fn, args) {
  openModal({
    title: "ยืนยันการโอน",
    body: html`${slip(p)}
      <label class="check-line"><input type="checkbox" name="ok">
        <span>โอนแล้ว และตรวจกับแอปธนาคารแล้ว ชื่อ เลขบัญชี และยอดเงินตรงกัน</span></label>
      <p class="small-print">ยืนยันแล้วแก้ไขไม่ได้อีก</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยังไม่โอน</button>
      <button type="submit" class="btn btn-primary btn-lg" disabled>ยืนยันการโอน</button>`,
    onMount: (form, close) => {
      const submit = form.querySelector("[type=submit]");
      form.ok.onchange = () => { submit.disabled = !form.ok.checked; };
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!form.ok.checked) return;
        busy(submit, async () => {
          const { error } = await sb.rpc(fn, args);
          close();
          if (error) { toast(errMsg(error), true); return route(); }
          toast(`ยืนยันการโอน ${money(p.amount)} บาท แล้ว`); route();
        });
      };
    },
  });
}

function returnModal(p) {
  openModal({
    title: "ส่งกลับให้สมาชิกแก้ไข",
    body: html`${slip(p)}<div class="field" style="margin-top:16px"><label for="f-reason">เหตุผล (ไม่บังคับ)</label>
      <textarea id="f-reason" name="reason" maxlength="300" placeholder="เช่น เลขบัญชีไม่ตรงกับชื่อ"></textarea></div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ปิด</button>
      <button type="submit" class="btn btn-danger">ส่งกลับให้แก้ไข</button>`,
    onMount: (form, close) => {
      form.onsubmit = (e) => {
        e.preventDefault();
        busy(form.querySelector("[type=submit]"), async () => {
          const { error } = await sb.rpc("return_payout", { p_id: p.id, p_reason: form.reason.value });
          close();
          if (error) { toast(errMsg(error), true); return route(); }
          toast("ส่งกลับให้สมาชิกแก้ไขแล้ว"); route();
        });
      };
    },
  });
}

// =====================================================================
// หน้า: รายงานรายวัน (แอดมินขึ้นไป)
// =====================================================================
async function viewReport(v, _id, alive) {
  const day = session("reportDay") || todayBkk();
  const from = `${day}T00:00:00+07:00`;
  const to = `${shiftDay(day, 1)}T00:00:00+07:00`;
  const { data, error } = await scope(sb.from("payout_requests").select(PCOLS)
    .in("status", ["transferred", "confirmed"]).gte("transferred_at", from).lt("transferred_at", to))
    .order("transferred_at");
  if (!alive()) return;
  if (error) return showError(v, error);

  const sum = data.reduce((s, p) => s + Number(p.amount), 0);
  const confirmed = data.filter((p) => p.status === "confirmed").length;
  const showLine = isOwner() && !ownerLine();
  const isToday = day >= todayBkk();

  v.innerHTML = html`
  <div class="page-head"><h1>รายงานรายวัน</h1>
    <div class="day-nav">
      <button class="btn btn-sm" data-day="-1" aria-label="วันก่อนหน้า">${svg(ICON.back, 16)}</button>
      <label class="date-pick">${svg(ICON.report, 18)}<span>${thaiDate(day)}</span>
        <input type="date" id="day" value="${day}" max="${todayBkk()}" aria-label="เลือกวันที่"></label>
      <button class="btn btn-sm" data-day="1" aria-label="วันถัดไป" ${isToday ? raw("disabled") : ""} style="transform:scaleX(-1)">${svg(ICON.back, 16)}</button>
    </div>
    <div class="page-meta"><span>${dayFmt.format(new Date(day + "T12:00:00+07:00"))}</span>${ownerLine() ? html`<span>${lineName(ownerLine())}</span>` : ""}</div>
  </div>

  <div class="daybar">
    <div class="total"><div class="k">ยอดโอนรวมของวัน</div><div class="v">${money(sum)}<small>บาท</small></div></div>
    <div class="stat"><div class="k">รายการ</div><div class="v">${data.length}</div></div>
    <div class="stat"><div class="k">ยืนยันแล้ว</div><div class="v">${confirmed}/${data.length}</div></div>
  </div>

  ${data.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>เวลา</th>${showLine ? html`<th>สาย</th>` : ""}<th>ลูกค้า</th><th>บัญชีปลายทาง</th>
      <th class="r">ยอด (บาท)</th><th>ผู้โอน</th><th>สถานะ</th></tr></thead>
    <tbody>${data.map((p) => html`<tr>
      <td class="num" data-label="เวลา">${clock(p.transferred_at)}</td>
      ${showLine ? html`<td data-label="สาย">${lineName(p.line_id)}</td>` : ""}
      <td data-label="ลูกค้า">${p.customer_line_name}</td>
      <td data-label="บัญชี"><div><span class="bank">${bankName(p.bank_code)}</span> <span class="num">${acctFmt(p.account_number)}</span></div>
        <div class="meta" style="margin-top:2px">${p.account_name || "ไม่ระบุชื่อบัญชี"}</div></td>
      <td class="r amount" style="font-size:16px" data-label="ยอด (บาท)">${money(p.amount)}</td>
      <td data-label="ผู้โอน">${p.transferrer?.display_name || ""}</td>
      <td data-label="สถานะ">${stamp(p.status)}</td></tr>`)}</tbody></table></div>`
    : emptyBox("ไม่มีการโอนในวันนี้", "เลือกวันอื่นจากปฏิทินด้านบน")}`.s;

  const setDay = (d) => { session("reportDay", d); route(); };
  const dayInput = v.querySelector("#day");
  dayInput.onchange = (e) => e.target.value && setDay(e.target.value);
  // เปิดปฏิทินเมื่อกดตรงไหนก็ได้บนป้ายวันที่
  dayInput.onclick = () => { try { dayInput.showPicker(); } catch { /* เบราว์เซอร์เก่าเปิดเองจากการแตะ */ } };
  v.onclick = (e) => {
    const b = e.target.closest("[data-day]");
    if (b && !b.disabled) setDay(shiftDay(day, Number(b.dataset.day)));
  };
}

// =====================================================================
// หน้า: ผู้ใช้ (ผู้ดูแลขึ้นไป)
// =====================================================================
async function manageUser(body) {
  const { data, error } = await sb.functions.invoke(FUNCTION_NAME, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    if (/Failed to send/i.test(msg)) msg = `ติดต่อ Edge Function "${FUNCTION_NAME}" ไม่ได้ ตรวจชื่อฟังก์ชันใน config.js`;
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function genPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function canManage(u) {
  if (u.id === state.me.id || u.role === "owner") return false;
  if (isOwner()) return true;
  return state.me.role === "supervisor" && ["admin", "member"].includes(u.role) && u.line_id === state.me.line_id;
}

async function viewUsers(v, _id, alive) {
  const { data, error } = await scope(sb.from("profiles")
    .select("id,username,display_name,role,line_id,is_active,created_at").neq("role", "owner"));
  if (!alive()) return;
  if (error) return showError(v, error);
  const users = data.sort((a, b) => (RANK[b.role] - RANK[a.role]) || a.display_name.localeCompare(b.display_name, "th"));
  const showLine = isOwner() && !ownerLine();
  const active = users.filter((u) => u.is_active).length;

  v.innerHTML = html`
  <div class="page-head"><h1>ผู้ใช้</h1>
    <button class="btn btn-primary" data-act="create">${svg(ICON.plus, 18)}สร้างบัญชี</button>
    <div class="page-meta"><span>${isOwner() ? (ownerLine() ? lineName(ownerLine()) : "ทุกสาย") : lineName(state.me.line_id)}</span>
      <span>ใช้งาน ${active} จาก ${users.length} บัญชี</span></div>
  </div>
  ${users.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>ชื่อ</th><th>Username</th><th>บทบาท</th>${showLine ? html`<th>สาย</th>` : ""}<th>สถานะ</th><th></th></tr></thead>
    <tbody>${users.map((u) => html`<tr class="${u.is_active ? "" : "off"}">
      <td class="cell-title"><b>${u.display_name}</b>${u.id === state.me.id ? " (คุณ)" : ""}</td>
      <td class="num" data-label="Username">${u.username}</td>
      <td data-label="บทบาท">${ROLE_TH[u.role]}</td>
      ${showLine ? html`<td data-label="สาย">${lineName(u.line_id)}</td>` : ""}
      <td data-label="สถานะ"><span class="pill-state ${u.is_active ? "on" : "off"}">${u.is_active ? "ใช้งาน" : "ระงับ"}</span></td>
      <td class="r cell-actions" style="white-space:nowrap">${canManage(u) ? html`
        <button class="btn btn-sm btn-quiet" data-act="reset" data-id="${u.id}">รีเซ็ตรหัสผ่าน</button>
        <button class="btn btn-sm ${u.is_active ? "btn-quiet btn-danger" : ""}" data-act="toggle" data-id="${u.id}">${u.is_active ? "ระงับ" : "เปิดใช้"}</button>` : ""}</td>
    </tr>`)}</tbody></table></div>` : emptyBox("ยังไม่มีผู้ใช้ในสายนี้", "กดสร้างบัญชีเพื่อเพิ่มคนแรก")}`.s;

  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const u = users.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "create") createUserModal();
    if (b.dataset.act === "reset") resetPasswordModal(u);
    if (b.dataset.act === "toggle") {
      const on = !u.is_active;
      confirmBox(on ? "เปิดใช้บัญชีนี้?" : "ระงับบัญชีนี้?",
        on ? `${u.display_name} จะเข้าระบบได้อีกครั้ง` : `${u.display_name} จะเข้าระบบไม่ได้ทันที ลูกค้าที่เคยเพิ่มยังอยู่ในสายตามเดิม`,
        on ? "เปิดใช้บัญชี" : "ระงับบัญชี", async () => {
          try { await manageUser({ action: "set_active", user_id: u.id, active: on }); }
          catch (err) { toast(err.message, true); return false; }
          toast(on ? "เปิดใช้บัญชีแล้ว" : "ระงับบัญชีแล้ว"); route(); return true;
        }, !on);
    }
  };
}

function credentialsModal(title, username, password) {
  openModal({
    title,
    body: html`<p style="margin:0 0 12px;color:var(--ink-2)">ส่งข้อมูลนี้ให้ผู้ใช้ รหัสผ่านจะไม่แสดงอีก</p>
      <div class="cred"><div class="k">Username</div><div class="v">${username}</div>
        <div class="k">รหัสผ่าน</div><div class="v">${password}</div></div>`,
    foot: html`<button type="button" class="btn" data-act="copy">คัดลอก</button>
      <button type="button" class="btn btn-primary" data-close>เสร็จแล้ว</button>`,
    onMount: (form) => {
      form.querySelector("[data-act=copy]").onclick = async () => {
        try { await navigator.clipboard.writeText(`Username: ${username}\nรหัสผ่าน: ${password}`); toast("คัดลอกแล้ว"); }
        catch { toast("คัดลอกไม่ได้ จดข้อมูลจากหน้าจอแทน", true); }
      };
    },
  });
}

const passwordField = () => html`<div class="field"><label for="f-pw">รหัสผ่าน</label>
  <div style="display:flex;gap:8px"><input id="f-pw" class="input-num" type="text" name="password" value="${genPassword()}" required>
  <button type="button" class="btn" data-act="gen">สุ่มใหม่</button></div>
  <span class="hint">อย่างน้อย 8 ตัวอักษร</span></div>`;

function createUserModal() {
  const roles = isOwner() ? ["supervisor", "admin", "member"] : ["admin", "member"];
  openModal({
    title: "สร้างบัญชีผู้ใช้",
    body: html`<div id="msg"></div>
      ${isOwner() ? html`<div class="field"><label for="f-uline">สาย</label><select id="f-uline" name="line_id" required>
        <option value="">เลือกสาย</option>${lineOptions(state.lineFilter)}</select></div>` : ""}
      <div class="field"><label for="f-role">บทบาท</label><select id="f-role" name="role">${roles.map((r) =>
        html`<option value="${r}" ${r === "member" ? raw("selected") : ""}>${ROLE_TH[r]}</option>`)}</select></div>
      <div class="field"><label for="f-dn">ชื่อที่แสดง</label><input id="f-dn" type="text" name="display_name" required maxlength="60"></div>
      <div class="field"><label for="f-un">Username</label>
        <input id="f-un" type="text" name="username" autocapitalize="none" spellcheck="false" required>
        <span class="hint">ใช้ได้เฉพาะ a-z 0-9 _ . ยาว 3–30 ตัว</span></div>
      ${passwordField()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">สร้างบัญชี</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.querySelector("[data-act=gen]").onclick = () => { form.password.value = genPassword(); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = {
          action: "create_user",
          line_id: isOwner() ? form.line_id.value : state.me.line_id,
          role: form.role.value,
          display_name: form.display_name.value.trim(),
          username: form.username.value.trim().toLowerCase(),
          password: form.password.value,
        };
        if (!body.line_id) return (msg.innerHTML = alertBox("danger", "เลือกสายก่อน"));
        busy(form.querySelector("[type=submit]"), async () => {
          try { await manageUser(body); }
          catch (err) { msg.innerHTML = alertBox("danger", err.message); return; }
          close(); route();
          credentialsModal("สร้างบัญชีแล้ว", body.username, body.password);
        });
      };
    },
  });
}

function resetPasswordModal(u) {
  openModal({
    title: "รีเซ็ตรหัสผ่าน " + u.display_name,
    body: html`<div id="msg"></div>${passwordField()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">ตั้งรหัสผ่านใหม่</button>`,
    onMount: (form, close) => {
      form.querySelector("[data-act=gen]").onclick = () => { form.password.value = genPassword(); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const password = form.password.value;
        busy(form.querySelector("[type=submit]"), async () => {
          try { await manageUser({ action: "reset_password", user_id: u.id, password }); }
          catch (err) { form.querySelector("#msg").innerHTML = alertBox("danger", err.message); return; }
          close();
          credentialsModal("ตั้งรหัสผ่านใหม่แล้ว", u.username, password);
        });
      };
    },
  });
}

// =====================================================================
// หน้า: สาย (เจ้าของเว็บ)
// =====================================================================
async function viewLines(v, _id, alive) {
  const [{ data: profiles }, counts] = await Promise.all([
    sb.from("profiles").select("line_id,role,is_active").neq("role", "owner"),
    Promise.all(state.lines.map((l) =>
      sb.from("customers").select("id", { count: "exact", head: true }).eq("line_id", l.id).then((r) => r.count || 0))),
  ]);
  if (!alive()) return;
  const people = (lineId, role) => (profiles || []).filter((p) => p.line_id === lineId && p.role === role && p.is_active).length;

  v.innerHTML = html`
  <div class="page-head"><h1>สาย</h1><button class="btn btn-primary" data-act="create">${svg(ICON.plus, 18)}สร้างสาย</button>
    <div class="page-meta"><span>สร้างผู้ดูแลของแต่ละสายได้ที่หน้าผู้ใช้ สายละไม่เกิน 2 คน</span></div></div>
  ${state.lines.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>สาย</th><th class="r">ผู้ดูแล</th><th class="r">แอดมิน</th><th class="r">สมาชิก</th><th class="r">ลูกค้า</th><th></th></tr></thead>
    <tbody>${state.lines.map((l, i) => html`<tr>
      <td class="cell-title"><b>${l.name}</b></td>
      <td class="r num" data-label="ผู้ดูแล">${people(l.id, "supervisor")}/2</td>
      <td class="r num" data-label="แอดมิน">${people(l.id, "admin")}</td>
      <td class="r num" data-label="สมาชิก">${people(l.id, "member")}</td>
      <td class="r num" data-label="ลูกค้า">${counts[i]}</td>
      <td class="r cell-actions"><button class="btn btn-sm btn-quiet" data-act="rename" data-id="${l.id}">เปลี่ยนชื่อ</button></td></tr>`)}</tbody>
  </table></div>` : emptyBox("ยังไม่มีสาย", "สร้างสายแรก แล้วสร้างผู้ดูแลของสายที่หน้าผู้ใช้")}`.s;

  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const line = state.lines.find((l) => l.id === b.dataset.id);
    openModal({
      title: line ? "เปลี่ยนชื่อสาย" : "สร้างสาย",
      body: html`<div id="msg"></div><div class="field"><label for="f-lt">ชื่อสาย</label>
        <input id="f-lt" type="text" name="line_title" value="${line?.name || ""}" maxlength="60" required></div>`,
      foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">${line ? "บันทึกชื่อ" : "สร้างสาย"}</button>`,
      onMount: (form, close) => {
        form.onsubmit = (ev) => {
          ev.preventDefault();
          const name = form.line_title.value.trim();
          if (!name) return;
          busy(form.querySelector("[type=submit]"), async () => {
            const { error } = line
              ? await sb.from("lines").update({ name }).eq("id", line.id)
              : await sb.from("lines").insert({ name });
            if (error) {
              form.querySelector("#msg").innerHTML = alertBox("danger", error.code === "23505" ? "ชื่อสายนี้มีแล้ว" : errMsg(error));
              return;
            }
            const { data } = await sb.from("lines").select("id,name").order("name");
            state.lines = data || [];
            close(); toast(line ? "บันทึกชื่อสายแล้ว" : "สร้างสายแล้ว"); route();
          });
        };
      },
    });
  };
}

// =====================================================================
// Boot
// =====================================================================
window.addEventListener("hashchange", route);
(async () => {
  if (configured) {
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && state.me) { state.me = null; route(); }
    });
    await loadMe();
  }
  route();
})();
