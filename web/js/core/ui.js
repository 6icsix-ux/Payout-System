// ส่วนประกอบหน้าจอที่ใช้ร่วมกัน: toast, หน้าต่าง, สลิป, รายการ
import { STATUS_TH } from "./config.js";
import { acctFmt, baht, bankName, clock, errMsg, isOwner, lineName, money, ownerLine, when } from "./format.js";
import { esc, html, raw } from "./html.js";
import { ICON, svg } from "./icons.js";
import { state } from "./state.js";

export function toast(msg, isErr = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  document.getElementById("toast-root").appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 2800);
}

export let modalOpen = false;

export const isModalOpen = () => modalOpen;

export function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
  modalOpen = false;
}

export function openModal({ title, body, foot = "", onMount, wide = false }) {
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
export async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) { toast("คัดลอกไม่ได้ กรุณาจดเลขเอง", true); return false; }
  if (btn) {
    const label = btn.innerHTML;
    btn.classList.add("copied"); btn.textContent = "คัดลอกแล้ว";
    setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = label; }, 1600);
  }
  return true;
}

// ปุ่ม submit ระหว่างทำงาน กันกดซ้ำ
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "กำลังบันทึก…";
  try { await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}

export const alertBox = (kind, content) => html`<div class="alert alert-${kind}">${content}</div>`.s;

export function confirmBox(title, message, okLabel, onOk, danger = false) {
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

export const stamp = (s) => html`<span class="stamp st-${s}">${STATUS_TH[s] || s}</span>`;

export const holderName = (n) => n ? n : html`<span class="no-name">ไม่ระบุชื่อบัญชี</span>`;

export const acctLine = (a) => html`<div class="acct"><span class="bank">${bankName(a.bank_code)}</span>
  <span class="num">${acctFmt(a.account_number)}</span><span class="holder">${holderName(a.account_name)}</span></div>`;

export const bankOptions = (selected = "") => state.banks.map((b) =>
  html`<option value="${b.code}" ${b.code === selected ? raw("selected") : ""}>${b.name_th}</option>`);

export const lineOptions = (selected = "") => state.lines.map((l) =>
  html`<option value="${l.id}" ${l.id === selected ? raw("selected") : ""}>${l.name}</option>`);

export const meta = (...items) => html`<div class="meta">${items.filter(Boolean).map((t) => html`<span>${t}</span>`)}</div>`;

// copy: แตะกล่องรายละเอียดเพื่อคัดลอกเลขบัญชี | pick: มีช่องติ๊กซ้ายสุด แตะตรงไหนของแถวก็ติ๊กได้ ({ checked })
export function payoutEntry(p, actions = "", { link = true, copy = false, pick = null } = {}) {
  return html`<div class="entry${pick ? " pickable" : ""}">
    ${pick ? html`<label class="pick-lead" title="เลือกรายการนี้"><input type="checkbox" data-pick="${p.id}" data-amt="${p.amount}" aria-label="เลือก ${p.customer_line_name}" ${pick.checked ? raw("checked") : ""}></label>` : ""}
    <div class="entry-main${copy ? " copy-acct" : ""}" ${copy ? raw(`data-copy-acct="${esc(p.account_number)}" role="button" tabindex="0" title="แตะเพื่อคัดลอกเลขบัญชี"`) : ""}>
      <div class="entry-title">${link
        ? html`<a href="#/c/${p.customer_id}">${p.customer_line_name}</a>` : p.customer_line_name} ${stamp(p.status)}</div>
      ${acctLine(p)}${copy ? html`<span class="copy-hint">${svg(ICON.copy, 14)}แตะเพื่อคัดลอกเลขบัญชี</span>` : ""}
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

export const isRecalled = (p) => p.returned_by && p.returned_by === p.created_by;

export const returnText = (p) => isRecalled(p) ? "ดึงกลับมาแก้ไข ยังไม่ได้ส่งใหม่"
  : `ถูกส่งกลับ${p.return_reason ? `: ${p.return_reason}` : " (ไม่ระบุเหตุผล)"}`;

// สลิปโอนเงิน: แสดงแค่ 3 อย่างที่ต้องใช้ตอนโอน + ยอดเงิน
export const slip = (p) => html`<div class="slip">
  <div class="slip-row"><span class="k">ชื่อไลน์</span><span class="v">${p.customer_line_name}</span></div>
  <div class="slip-row"><span class="k">ชื่อบัญชี</span><span class="v">${p.account_name || html`<span class="no-name">ไม่ระบุ ตรวจชื่อในแอปธนาคารก่อนโอน</span>`}</span></div>
  <div class="slip-row"><span class="k">ธนาคาร</span><span class="v">${bankName(p.bank_code)}</span></div>
  <div class="slip-row slip-row-acct"><span class="k">เลขบัญชี</span>
    <span class="v"><span class="slip-acct">${acctFmt(p.account_number)}</span>
      <button type="button" class="copy-btn" data-copy="${p.account_number}" aria-label="คัดลอกเลขบัญชี">${svg(ICON.copy, 16)}คัดลอก</button></span></div>
  <div class="slip-amount"><span class="k">ยอดเงิน</span><span class="v">${money(p.amount)}<small>บาท</small></span></div>
  ${p.note ? html`<div class="slip-note">หมายเหตุ: ${p.note}</div>` : ""}
</div>`;

export const emptyBox = (title, sub = "") => html`<div class="empty"><b>${title}</b>${sub}</div>`;

export function showError(el, e) { el.innerHTML = alertBox("danger", errMsg(e)); }
