// เพิ่มลูกค้าหลายรายจากข้อความ
import { parseBulk } from "../lib/bulk-parse.js";
import { sb } from "../core/config.js";
import { digits, errMsg, isOwner, lineName, normName } from "../core/format.js";
import { html, raw } from "../core/html.js";
import { parseRoute } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, bankOptions, busy, lineOptions, openModal, stamp } from "../core/ui.js";
import { viewCustomers } from "./customers.js";

export const BULK_KIND = {
  new: ["st-confirmed", "ลูกค้าใหม่"],
  add: ["st-transferred", "เพิ่มบัญชี"],
  skip: ["st-cancelled", "ข้าม"],
  fix: ["st-returned", "ต้องแก้"],
};

export function bulkPasteModal(prefillText = "", prefillLine = "") {
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
export async function loadLineIndex(lineId) {
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
export function evaluateBulk(items, index) {
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

export function bulkReviewModal(lineId, items, index, sourceText) {
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

export async function saveBulk(lineId, items, index) {
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

export function bulkResultModal(r) {
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
