// ช่องกรอกและการตรวจข้อมูลที่ใช้ร่วมกัน (บัญชี ยอดเงิน เช็คซ้ำ)
import { sb } from "./config.js";
import { digits } from "./format.js";
import { html } from "./html.js";
import { alertBox, bankOptions } from "./ui.js";

// เช็คว่าเลขบัญชีนี้มีในสายแล้วหรือยัง คืนค่าบัญชีที่ซ้ำ (ถ้ามี)
export async function findDuplicateAccount(lineId, bank, number, exceptId = null) {
  let q = sb.from("bank_accounts").select("id,customer_id,account_name,customers(line_name)")
    .eq("line_id", lineId).eq("bank_code", bank).eq("account_number", number);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.maybeSingle();
  return data;
}

// เช็คชื่อไลน์ซ้ำในสาย (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย)
export async function findDuplicateName(lineId, name, exceptId = null) {
  const { data } = await sb.from("customers").select("id,line_name").eq("line_id", lineId).limit(1000);
  const key = name.trim().toLowerCase();
  return (data || []).find((c) => c.id !== exceptId && c.line_name.trim().toLowerCase() === key);
}

export const dupAccountAlert = (d) => alertBox("warn", html`เลขบัญชีนี้มีอยู่แล้ว เป็นของลูกค้า
  <a href="#/c/${d.customer_id}">${d.customers?.line_name}</a> ${d.account_name ? `(ชื่อบัญชี ${d.account_name})` : ""}`);

export const dupNameAlert = (c) => alertBox("warn", html`มีลูกค้าชื่อไลน์ <a href="#/c/${c.id}">${c.line_name}</a> ในสายแล้ว
  บันทึกซ้ำไม่ได้ ถ้าเป็นคนเดียวกัน ให้เข้าไปเพิ่มบัญชีที่ลูกค้าคนนั้น`);

export const bankAndNumberFields = (a = {}) => html`<div class="row">
  <div class="field"><label for="f-bank">ธนาคาร</label>
    <select id="f-bank" name="bank_code" required><option value="">เลือกธนาคาร</option>${bankOptions(a.bank_code)}</select></div>
  <div class="field"><label for="f-num">เลขบัญชี</label>
    <input id="f-num" class="input-num" type="text" name="account_number" inputmode="numeric" value="${a.account_number || ""}" required
      placeholder="ตัวเลขเท่านั้น"></div>
</div>`;

export const accountNameField = (value = "") => html`<div class="field"><label for="f-holder">ชื่อบัญชีธนาคาร <span class="opt">(ไม่บังคับ)</span></label>
  <input id="f-holder" type="text" name="account_name" value="${value || ""}" placeholder="ถ้าลูกค้าไม่ได้ให้มา เว้นว่างได้"></div>`;

export function readAccount(form, fixedName = null) {
  const a = {
    account_name: (fixedName ?? form.account_name.value.trim()) || null,
    bank_code: form.bank_code.value,
    account_number: digits(form.account_number.value),
  };
  if (!a.bank_code) return [null, "เลือกธนาคาร"];
  if (!/^\d{6,20}$/.test(a.account_number)) return [null, "เลขบัญชีต้องเป็นตัวเลข 6–20 หลัก"];
  return [a, null];
}

export const amountFields = (value = "") => html`<div class="field"><label for="f-amt">ยอดเงิน (บาท)</label>
    <input id="f-amt" class="input-amount" type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" value="${value}" required placeholder="0.00"></div>
  <div class="field"><label for="f-note">หมายเหตุ (ไม่บังคับ)</label><textarea id="f-note" name="note" maxlength="300"></textarea></div>`;

export function readAmount(form) {
  const n = Math.round(Number(form.amount.value) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}
