// เมนู โครงหน้า และการเปลี่ยนหน้า
import { ROLE_TH, SUPABASE_ANON_KEY, SUPABASE_URL, configured, sb } from "./config.js";
import { initial, isOwner, lineName, rank, scope, storage } from "./format.js";
import { html, raw } from "./html.js";
import { BRAND, ICON, svg } from "./icons.js";
import { app, state } from "./state.js";
import { closeModal, lineOptions, showError } from "./ui.js";
import { changeOwnPasswordModal } from "../pages/account.js";
import { viewCustomer } from "../pages/customer.js";
import { viewCustomers } from "../pages/customers.js";
import { viewLines } from "../pages/lines.js";
import { viewLogin } from "../pages/login.js";
import { viewMy } from "../pages/my.js";
import { viewQueue } from "../pages/queue.js";
import { viewReport } from "../pages/report.js";
import { viewUsers } from "../pages/users.js";

export const NAV = [
  ["customers", "ลูกค้า", 1],
  ["my", "รายการของฉัน", 1],
  ["queue", "คิวโอน", 2],
  ["report", "รายงานรายวัน", 2],
  ["users", "ผู้ใช้", 3],
  ["lines", "สาย", 4],
];

export const NAV_SHORT = { customers: "ลูกค้า", my: "ของฉัน", queue: "คิวโอน", report: "รายงาน", users: "ผู้ใช้", lines: "สาย" };

export function parseRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "customers", id };
}

// ไฮไลต์เมนูของหน้าปัจจุบัน (ไม่ต้องสร้างเมนูใหม่)
function markActive(current) {
  document.querySelectorAll(".side-nav a, .tabbar a").forEach((a) => {
    const k = a.getAttribute("href").replace("#/", "");
    a.classList.toggle("active", current === k || (k === "customers" && current === "c"));
  });
}

export function renderShell(current) {
  const me = state.me;
  // สร้างโครงหน้า (เมนู แถบบน) ครั้งเดียวต่อผู้ใช้ เปลี่ยนหน้าแล้วไม่ต้องสร้างใหม่ = ไม่กระพริบ
  const key = `${me.id}:${me.role}:${state.lines.map((l) => l.id + l.name).join(",")}`;
  if (state.shellKey === key && document.getElementById("view")) {
    markActive(current);
    app.querySelectorAll("#line-filter, #line-filter-m").forEach((sel) => { sel.value = state.lineFilter; });
    if (rank() >= 2) refreshQueueCount();
    return false;
  }
  state.shellKey = key;
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
    b.onclick = async () => { await sb.auth.signOut(); state.me = null; state.shellKey = null; location.hash = ""; route(); };
  });
  app.querySelectorAll("[data-passwd]").forEach((b) => { b.onclick = () => changeOwnPasswordModal(); });
  app.querySelectorAll("#line-filter, #line-filter-m").forEach((sel) => {
    sel.onchange = () => { state.lineFilter = sel.value; storage("lineFilter", sel.value); route(); };
  });
  if (rank() >= 2) refreshQueueCount();
  return true;
}

export async function refreshQueueCount() {
  const { count } = await scope(sb.from("payout_requests").select("id", { count: "exact", head: true }).eq("status", "pending"));
  document.querySelectorAll("[data-queue-count]").forEach((el) => { el.textContent = count || ""; el.hidden = !count; });
}

export const VIEWS = {
  customers: [1, viewCustomers],
  c: [1, viewCustomer],
  my: [1, viewMy],
  queue: [2, viewQueue],
  report: [2, viewReport],
  users: [3, viewUsers],
  lines: [4, viewLines],
};

export function route() {
  clearInterval(state.timer);
  closeModal();
  if (!configured) {
    app.innerHTML = html`<div class="login-wrap"><div class="login">${BRAND}<h1>ยังไม่ได้ตั้งค่า</h1>
      <p>ใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ในไฟล์ config.js แล้วโหลดหน้านี้ใหม่</p></div></div>`.s;
    return;
  }
  if (!state.me) { state.shellKey = null; return viewLogin(); }
  const r = parseRoute();
  let entry = VIEWS[r.name];
  if (!entry || rank() < entry[0]) { r.name = "customers"; entry = VIEWS.customers; }
  const fresh = renderShell(r.name);
  const view = document.getElementById("view");
  const id = ++state.renderId;
  // เปลี่ยนไปหน้าอื่นจริงถึงเลื่อนขึ้นบนสุด (กดแท็บ/รีเฟรชหน้าเดิม คงตำแหน่งเดิม)
  const where = `${r.name}/${r.id || ""}`;
  if (fresh || state.lastRoute !== where) window.scrollTo(0, 0);
  state.lastRoute = where;
  // เนื้อหาเดิมค้างไว้จนหน้าใหม่พร้อม ระหว่างนั้นกดไม่ได้และมีแถบโหลดด้านบน
  view.onclick = null;
  view.classList.add("is-loading");
  const done = () => { if (id === state.renderId) view.classList.remove("is-loading"); };
  entry[1](view, r.id, () => id === state.renderId)
    .catch((e) => { if (id === state.renderId) showError(view, e); })
    .finally(done);
}
