// หน้าลูกค้า: ค้นหา และเพิ่มลูกค้า
import { sb } from "../core/config.js";
import { acctFmt, bankName, digits, errMsg, initial, isOwner, ownerLine, rank, session, storage } from "../core/format.js";
import { accountNameField, bankAndNumberFields, dupAccountAlert, dupNameAlert, findDuplicateAccount, findDuplicateName, readAccount } from "../core/forms.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { refreshQueueCount } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, emptyBox, holderName, lineOptions, meta, openModal, showError, toast } from "../core/ui.js";
import { bulkPasteModal } from "./bulk-customers.js";

export async function viewCustomers(v, _id, alive) {
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

export function addCustomerModal(prefill = "") {
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
