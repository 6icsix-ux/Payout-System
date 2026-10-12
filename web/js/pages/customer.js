// หน้ารายละเอียดลูกค้า: บัญชี และสร้างรายการโอน
import { PCOLS, sb } from "../core/config.js";
import { errMsg, isOwner, lineName, money, when } from "../core/format.js";
import { accountNameField, amountFields, bankAndNumberFields, dupAccountAlert, dupNameAlert, findDuplicateAccount, findDuplicateName, readAccount, readAmount } from "../core/forms.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { acctLine, alertBox, busy, emptyBox, meta, openModal, payoutEntry, slip, toast } from "../core/ui.js";

export async function viewCustomer(v, id, alive) {
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

export function renameCustomerModal(c, done) {
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
export function addAccountModal(c, holder, done) {
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

export function editAccountModal(c, acct, done) {
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

export function createPayoutModal(c, acct) {
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
