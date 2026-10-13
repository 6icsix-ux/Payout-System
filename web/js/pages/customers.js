// หน้าลูกค้า: ค้นหา และเพิ่มลูกค้า
import { sb } from "../core/config.js";
import { acctFmt, bankName, digits, errMsg, initial, isOwner, lineName, ownerLine, rank, scope, session, storage } from "../core/format.js";
import { accountNameField, bankAndNumberFields, dupAccountAlert, dupNameAlert, findDuplicateAccount, findDuplicateName, readAccount } from "../core/forms.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { refreshQueueCount } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, emptyBox, holderName, lineOptions, meta, openModal, showError, toast } from "../core/ui.js";
import { bulkPasteModal } from "./bulk-customers.js";

const PAGE_SIZES = [30, 60, 90];

// ค้นหาแบบแบ่งหน้า ถ้ายังไม่ได้รัน SQL 005 จะใช้ฟังก์ชันค้นหาเดิมแล้วแบ่งหน้าในเครื่องแทน
async function searchPage(text, lineId, limit, offset) {
  const { data, error } = await sb.rpc("search_customers_page", { p_q: text, p_line_id: lineId, p_limit: limit, p_offset: offset });
  if (!error) return { data, total: Number(data[0]?.total_count ?? 0), error: null };
  if (error.code !== "PGRST202" && !/search_customers_page/.test(error.message || "")) return { data: [], total: 0, error };
  const old = await sb.rpc("search_customers", { p_q: text, p_line_id: lineId });
  if (old.error) return { data: [], total: 0, error: old.error };
  return { data: old.data.slice(offset, offset + limit), total: old.data.length, error: null };
}

export async function viewCustomers(v, _id, alive) {
  v.innerHTML = html`
  <div class="page-head"><h1>ลูกค้า <span class="h-count" id="c-count" hidden></span></h1>
    <button class="btn" id="bulk">${svg(ICON.paste, 18)}วางหลายราย</button>
    <button class="btn btn-primary" id="add">${svg(ICON.plus, 18)}เพิ่มลูกค้า</button></div>
  <div class="search-row">
    <label class="search">${svg(ICON.search)}
      <input type="search" id="q" placeholder="ค้นหาด้วยชื่อไลน์ ชื่อบัญชี หรือเลขบัญชี" autocomplete="off" aria-label="ค้นหาลูกค้า"></label>
    ${isOwner() ? html`<select id="q-line" class="search-line" aria-label="ค้นหาในสาย">
      <option value="">ทุกสาย</option>${lineOptions(state.lineFilter)}</select>` : ""}
  </div>
  <div id="results"></div>
  <div class="pager" id="pager" hidden>
    <label class="pager-size">แสดง
      <select id="page-size" aria-label="จำนวนต่อหน้า">${PAGE_SIZES.map((n) => html`<option value="${n}">${n}</option>`)}</select>
      รายการ</label>
    <span class="pager-info" id="pager-info"></span>
    <div class="pager-nav">
      <button type="button" class="btn btn-sm" data-page="prev" aria-label="หน้าก่อน">${svg(ICON.back, 16)}</button>
      <span class="pager-pos num" id="pager-pos"></span>
      <button type="button" class="btn btn-sm" data-page="next" aria-label="หน้าถัดไป" style="transform:scaleX(-1)">${svg(ICON.back, 16)}</button>
    </div>
  </div>`.s;

  const q = v.querySelector("#q");
  const res = v.querySelector("#results");
  const countEl = v.querySelector("#c-count");
  let total = null;
  // จำนวนลูกค้าทั้งหมดของสาย (เจ้าของเว็บ: ตามสายที่เลือก หรือทุกสาย)
  const loadCount = async () => {
    const { count, error } = await scope(sb.from("customers").select("id", { count: "exact", head: true }));
    if (!alive() || error) return;
    total = count ?? 0;
    showCount();
  };
  let found = null;
  // แบ่งหน้า: ค่าเริ่มต้น 30 รายการ เลือก 30 / 60 / 90 (จำค่าไว้ในเครื่อง)
  const sizeSel = v.querySelector("#page-size");
  const pager = v.querySelector("#pager");
  let size = PAGE_SIZES.includes(Number(storage("pageSize"))) ? Number(storage("pageSize")) : PAGE_SIZES[0];
  let page = 0;
  sizeSel.value = String(size);
  const showCount = () => {
    if (total == null) return;
    const where = isOwner() ? (ownerLine() ? lineName(ownerLine()) : "ทุกสาย") : "";
    const searching = q.value.trim() && found != null;
    countEl.textContent = searching
      ? `พบ ${found.toLocaleString("th-TH")} จาก ${total.toLocaleString("th-TH")} คน`
      : `${total.toLocaleString("th-TH")} คน`;
    countEl.title = where ? `จำนวนลูกค้า ${where}` : "จำนวนลูกค้าในสาย";
    countEl.hidden = false;
  };
  q.value = session("custQ");
  let seq = 0, t;
  const run = async () => {
    const my = ++seq;
    session("custQ", q.value);
    const { data, total: hits, error } = await searchPage(q.value, ownerLine(), size, page * size);
    if (my !== seq || !alive()) return;
    if (error) return showError(res, error);
    // หน้าที่เลือกเกินจำนวนที่มี (เช่น ลบคำค้นแล้วผลน้อยลง) กลับไปหน้าสุดท้าย
    if (!data.length && hits > 0 && page > 0) { page = Math.floor((hits - 1) / size); return run(); }
    found = hits;
    showCount();
    const pages = Math.max(1, Math.ceil(hits / size));
    pager.hidden = hits === 0;
    v.querySelector("#pager-info").textContent = hits
      ? `${(page * size + 1).toLocaleString("th-TH")}–${Math.min((page + 1) * size, hits).toLocaleString("th-TH")} จาก ${hits.toLocaleString("th-TH")}` : "";
    v.querySelector("#pager-pos").textContent = `${page + 1} / ${pages}`;
    v.querySelector('[data-page="prev"]').disabled = page === 0;
    v.querySelector('[data-page="next"]').disabled = page >= pages - 1;
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
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { page = 0; run(); }, 250); };
  sizeSel.onchange = () => { size = Number(sizeSel.value); storage("pageSize", String(size)); page = 0; run(); };
  pager.onclick = (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    page += b.dataset.page === "next" ? 1 : -1;
    run().then(() => res.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  // เลือกสาย (เฉพาะเจ้าของเว็บ): ใช้ค่าเดียวกับตัวเลือกสายในเมนู
  const qLine = v.querySelector("#q-line");
  if (qLine) qLine.onchange = () => {
    state.lineFilter = qLine.value;
    storage("lineFilter", qLine.value);
    document.querySelectorAll("#line-filter, #line-filter-m").forEach((sel) => { sel.value = qLine.value; });
    if (rank() >= 2) refreshQueueCount();
    page = 0;
    run();
    loadCount();
  };
  q.focus();
  v.querySelector("#add").onclick = () => addCustomerModal(q.value);
  v.querySelector("#bulk").onclick = () => bulkPasteModal();
  await Promise.all([run(), loadCount()]);
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
