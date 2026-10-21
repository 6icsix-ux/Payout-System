// หน้ารายละเอียดลูกค้า: บัญชี และสร้างรายการโอน
import { PCOLS, sb } from "../core/config.js";
import { acctFmt, bankName, errMsg, isOwner, lineName, money, rank, when } from "../core/format.js";
import { accountNameField, amountFields, bankAndNumberFields, dupAccountAlert, dupNameAlert, findDuplicateAccount, findDuplicateName, readAccount, readAmount } from "../core/forms.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { acctLine, alertBox, busy, emptyBox, holderName, meta, openModal, payoutEntry, slip, toast } from "../core/ui.js";

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
    <div class="menu-wrap">
      <button class="btn btn-sm edit-btn" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="แก้ไขลูกค้า" title="แก้ไขลูกค้า">${svg(ICON.edit, 18)}</button>
      <div class="menu" role="menu" hidden>
        <button type="button" role="menuitem" data-act="rename">${svg(ICON.edit, 16)}แก้ชื่อไลน์</button>
        ${rank() >= 3 ? html`<button type="button" role="menuitem" class="danger" data-act="delete">${svg(ICON.trash, 16)}ลบลูกค้า</button>` : ""}
      </div></div>
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
  // เมนูแก้ไข (ไอคอนดินสอ): แก้ชื่อไลน์ / ลบลูกค้า
  const menu = v.querySelector(".menu");
  const menuBtn = v.querySelector("[data-act=menu]");
  const setMenu = (open) => {
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", open);
    if (open) menu.querySelector("button")?.focus();
  };
  const outside = (e) => { if (!menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false); };
  const onKey = (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); menuBtn.focus(); } };
  document.addEventListener("click", outside);
  document.addEventListener("keydown", onKey);
  state.cleanup = () => { document.removeEventListener("click", outside); document.removeEventListener("keydown", onKey); };
  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "menu") return setMenu(menu.hidden);
    if (b.closest(".menu")) setMenu(false);
    const acct = accounts.find((a) => a.id === b.dataset.id);
    if (b.dataset.act === "rename") renameCustomerModal(c, reload);
    if (b.dataset.act === "delete") deleteCustomerModal(c, accounts);
    if (b.dataset.act === "add-acct") addAccountModal(c, holder, reload);
    if (b.dataset.act === "edit-acct") editAccountModal(c, acct, reload);
    if (b.dataset.act === "pay") createPayoutModal(c, acct);
  };
}

// ลบลูกค้า (ผู้ดูแลและเจ้าของเว็บ): ตรวจรายการค้างก่อน แสดงสิ่งที่จะถูกลบ ต้องติ๊กยืนยัน
// ปุ่มยกเลิกได้โฟกัสไว้ก่อน กด Enter โดยไม่ตั้งใจจะไม่ลบ
const ACTIVE = { pending: "รอโอน", transferred: "โอนแล้ว รอยืนยัน", returned: "ส่งกลับแก้ไข" };
export async function deleteCustomerModal(c, accounts) {
  const { data: rows, error } = await sb.from("payout_requests").select("status,amount").eq("customer_id", c.id).limit(10000);
  if (error) { toast(errMsg(error), true); return; }
  const by = (st) => rows.filter((r) => r.status === st);
  const active = rows.filter((r) => ACTIVE[r.status]);
  const confirmed = by("confirmed");
  const other = rows.length - active.length - confirmed.length;
  const sum = (list) => money(list.reduce((s, r) => s + Number(r.amount), 0));
  const needName = confirmed.length > 0;

  openModal({
    title: "ลบลูกค้า",
    body: html`<div id="msg"></div>
      <div class="del-who"><div class="k">ลูกค้าที่จะลบ</div><div class="v">${c.line_name}</div>
        ${isOwner() ? html`<div class="meta">สาย ${lineName(c.line_id)}</div>` : ""}</div>
      ${accounts.length ? html`<div class="del-accts">${accounts.map((a) => html`<div class="del-acct"><span class="bank">${bankName(a.bank_code)}</span>
        <span class="num">${acctFmt(a.account_number)}</span> <span class="holder">${holderName(a.account_name)}</span></div>`)}</div>` : ""}
      ${active.length ? html`<div class="alert alert-danger"><b>ยังลบไม่ได้</b> ลูกค้านี้มีรายการค้าง ${active.length} รายการ
          (${Object.entries(ACTIVE).map(([k, t]) => by(k).length ? `${t} ${by(k).length}` : "").filter(Boolean).join(", ")})
          ให้ยืนยันหรือยกเลิกรายการเหล่านั้นให้หมดก่อน</div>`
        : html`<ul class="del-list">
          <li>บัญชีธนาคาร <b>${accounts.length}</b> บัญชี</li>
          <li>ประวัติรายการโอน <b>${rows.length}</b> รายการ${rows.length ? ` (ยืนยันแล้ว ${confirmed.length}${other ? `, ยกเลิก ${other}` : ""})` : ""}</li></ul>
        ${needName ? html`<div class="alert alert-warn">มีรายการที่<b>โอนและยืนยันแล้ว ${confirmed.length} รายการ รวม ${sum(confirmed)} บาท</b>
            รายการเหล่านี้จะหายจากรายงานรายวันด้วย</div>
          <div class="field"><label for="del-name">พิมพ์ชื่อไลน์ลูกค้า <b>${c.line_name}</b> เพื่อยืนยัน</label>
            <input id="del-name" name="confirm_name" type="text" autocomplete="off"></div>` : ""}
        <label class="check-line del-check"><input type="checkbox" name="ok">
          <span>ตรวจสอบแล้ว ต้องการลบลูกค้า <b>${c.line_name}</b> และข้อมูลด้านบนทั้งหมดถาวร</span></label>
        <p class="small-print">ลบแล้วกู้คืนจากหน้าเว็บไม่ได้</p>`}`,
    foot: html`<button type="button" class="btn btn-primary" data-close data-cancel>ยกเลิก</button>
      ${active.length ? "" : html`<button type="button" class="btn btn-danger" data-act="do-delete" disabled>ลบลูกค้า</button>`}`,
    onMount: (form, close) => {
      const cancel = form.querySelector("[data-cancel]");
      const del = form.querySelector("[data-act=do-delete]");
      const msg = form.querySelector("#msg");
      // โฟกัสที่ปุ่มยกเลิก (หลังหน้าต่างเปิดเสร็จ)
      setTimeout(() => cancel.focus(), 0);
      // ไม่มีปุ่ม submit: กด Enter ที่ไหนก็ไม่ลบ ต้องกดปุ่มลบเท่านั้น
      form.onsubmit = (e) => e.preventDefault();
      if (!del) return;
      const ready = () => form.ok.checked && (!needName || form.confirm_name.value.trim() === c.line_name.trim());
      form.oninput = form.onchange = () => { del.disabled = !ready(); };
      del.onclick = () => {
        if (!ready()) return;
        busy(del, async () => {
          const { data, error } = await sb.rpc("delete_customer", { p_id: c.id });
          if (error) { msg.innerHTML = alertBox("danger", errMsg(error)); return; }
          // ตรวจซ้ำว่าลบออกจากระบบแล้วจริง
          const check = await sb.from("customers").select("id").eq("id", c.id).maybeSingle();
          if (check.error || check.data) { msg.innerHTML = alertBox("danger", "ตรวจสอบแล้วลูกค้ายังอยู่ในระบบ ลองโหลดหน้าใหม่แล้วลองอีกครั้ง"); return; }
          close();
          toast(`ลบลูกค้า ${c.line_name} แล้ว (บัญชี ${data?.accounts ?? accounts.length}, รายการ ${data?.payouts ?? rows.length})`);
          location.hash = "#/customers";
        });
      };
    },
  });
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
