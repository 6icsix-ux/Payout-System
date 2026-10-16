// แจ้งโอนหลายรายจากข้อความ
import { parseBulkPayout, similarName } from "../lib/bulk-parse.js";
import { sb } from "../core/config.js";
import { acctFmt, bankName, errMsg, isOwner, lineName, money, normName, session } from "../core/format.js";
import { html, part, raw } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { parseRoute } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, lineOptions, openModal, stamp } from "../core/ui.js";
import { viewMy } from "./my.js";
import { MAX_ATTACH, localPicker, uid, uploadImages } from "../core/images.js";

// แจ้งโอนหลายราย: วางข้อความ ($):@ชื่อไลน์ (+) ยอด แล้วจับคู่กับลูกค้าในสาย
export function bulkPayoutModal(prefillText = "", prefillLine = "", files = []) {
  const pickLine = isOwner();
  openModal({
    title: "แจ้งโอนหลายราย",
    wide: true,
    body: html`<div id="msg"></div>
      ${pickLine ? html`<div class="field"><label for="bp-line">สาย</label>
        <select id="bp-line" name="line_id"><option value="">เลือกสาย</option>${lineOptions(prefillLine || state.lineFilter)}</select></div>` : ""}
      <div class="field"><label for="bp-text">วางรายการโอน</label>
        <textarea id="bp-text" name="text" rows="12" class="bulk-text" placeholder="($):@ชื่อไลน์ (+) 190&#10;($):@ชื่อไลน์ (+) 475+475-320 = *630*"></textarea>
        <span class="hint">บรรทัดละ 1 รายการ ชื่อไลน์อยู่ก่อน (+) ยอดเงินอยู่หลัง (+) หรือหลัง = ถ้ามี</span></div>
      <div class="field"><span class="label">แนบรูป <span class="opt">(ไม่บังคับ แอดมินจะเห็นรูปเหนือรายการชุดนี้)</span></span>
        <div class="img-upload"><label class="btn">${svg(ICON.camera, 18)}เลือกรูป
          <input type="file" accept="image/*" multiple hidden data-picker-input></label>
          <span class="hint img-hint">ไม่เกิน ${MAX_ATTACH} รูป หรือกด Ctrl+V วางรูปที่คัดลอกไว้</span></div>
        <div data-picker></div></div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary">จับคู่ลูกค้า</button>`,
    onMount: (form) => {
      form.text.value = prefillText;
      localPicker(form, files);
      const msg = form.querySelector("#msg");
      form.onsubmit = (e) => {
        e.preventDefault();
        const lineId = pickLine ? form.line_id.value : state.me.line_id;
        if (!lineId) return (msg.innerHTML = alertBox("danger", "เลือกสายก่อน"));
        const rows = parseBulkPayout(form.text.value);
        if (!rows.length) return (msg.innerHTML = alertBox("danger", "ไม่พบรายการในข้อความ"));
        const text = form.text.value;
        busy(form.querySelector("[type=submit]"), async () => {
          const [cRes, pRes] = await Promise.all([
            sb.from("customers").select("id,line_name,bank_accounts(id,account_number,bank_code,account_name,created_at)")
              .eq("line_id", lineId).order("line_name").limit(10000),
            sb.from("payout_requests").select("customer_id,amount").eq("line_id", lineId).eq("status", "pending").limit(10000),
          ]);
          if (cRes.error || pRes.error) { msg.innerHTML = alertBox("danger", "โหลดข้อมูลลูกค้าไม่สำเร็จ ลองอีกครั้ง"); return; }
          bulkPayoutReview(lineId, rows, cRes.data, pRes.data, text, files);
        });
      };
    },
  });
}

// กล่องแจ้งรายการที่ยังไม่ได้ส่ง: ชื่อ ยอด เหตุผล + ปุ่มคัดลอกข้อความเดิมไว้วางส่งใหม่
export function notSentBox(list, title) {
  const lines = list.map((x) => x.raw).join("\n");
  return html`<div class="alert alert-danger not-sent">
    <div class="not-sent-head"><b>${title}</b>
      <button type="button" class="copy-btn" data-copy="${lines}">${svg(ICON.copy, 16)}คัดลอกรายการ</button></div>
    <ul class="bulk-result">${list.map((x) => html`<li><b>${x.name || "(ไม่มีชื่อ)"}</b>
      ${Number(x.amount) > 0 ? `${money(x.amount)} บาท` : "(ไม่มียอด)"} <span class="why">${x.reason}</span></li>`)}</ul>
  </div>`;
}

export function bulkPayoutReview(lineId, rows, customers, pending, sourceText, files = []) {
  // บัญชีล่าสุดของลูกค้าเป็นค่าเริ่มต้น (ลูกค้าที่เปลี่ยนบัญชี จะใช้บัญชีใหม่)
  for (const c of customers) c.bank_accounts.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(customers.map((c) => [c.id, c]));

  // จับคู่ชื่อ: ถ้ามีลูกค้าชื่อเหมือนหรือคล้ายกันมากกว่า 1 คน (เช่น Tukta กับ Tuktaริน7)
  // จะไม่เลือกให้อัตโนมัติ ผู้ใช้ต้องเลือกคนที่ถูกเองก่อนส่ง
  const items = rows.map((r, i) => {
    const similar = customers.filter((c) => similarName(r.name, c.line_name));
    const exactIds = new Set(similar.filter((c) => normName(c.line_name) === normName(r.name)).map((c) => c.id));
    similar.sort((a, b) => exactIds.has(b.id) - exactIds.has(a.id));
    const one = similar.length === 1 ? similar[0] : null;
    return {
      i, raw: r.raw, name: r.name, parseNotes: r.notes, removed: false,
      amount: r.amount ?? "",
      candidates: similar.length > 1 ? similar.map((c) => c.id) : [],
      exactIds,
      fuzzy: !!one && !exactIds.has(one.id),
      customer_id: one?.id || "",
      bank_account_id: one?.bank_accounts[0]?.id || "",
    };
  });

  // ตัวเลือกลูกค้าชื่อคล้ายกัน แสดงบัญชีให้เห็นชัดก่อนเลือก
  const acctText = (a) => a ? `${bankName(a.bank_code)} ${acctFmt(a.account_number)}${a.account_name ? ` ${a.account_name}` : ""}` : "ยังไม่มีบัญชี";
  const candidatePicker = (it) => it.candidates.length ? html`<div class="cand-pick" role="radiogroup" aria-label="เลือกลูกค้าที่ถูกคน">
    <div class="cand-title">มีลูกค้าชื่อเหมือนหรือคล้ายกัน ${it.candidates.length} คน แตะเลือกคนที่ถูกต้อง</div>
    ${it.candidates.map((id) => { const c = byId.get(id); return html`<label class="cand">
      <input type="radio" name="cand-${it.i}" value="${id}" data-f="customer_id" ${id === it.customer_id ? raw("checked") : ""}>
      <span class="cand-body"><span class="cand-name">${c.line_name}${it.exactIds.has(id) ? html` <span class="cand-tag">ชื่อตรงกับข้อความ</span>` : ""}</span>
        <span class="cand-acct">${acctText(c.bank_accounts[0])}${c.bank_accounts.length > 1 ? ` (+${c.bank_accounts.length - 1} บัญชี)` : ""}</span></span>
    </label>`; })}</div>` : "";

  const customerOptions = (it) => html`<option value="">${it.candidates.length ? "เลือกลูกค้าที่ถูกคน" : "ไม่พบ เลือกลูกค้า"}</option>
    ${(it.candidates.length ? it.candidates.map((id) => byId.get(id)) : customers).map((c) =>
      html`<option value="${c.id}" ${c.id === it.customer_id ? raw("selected") : ""}>${c.line_name}</option>`)}
    ${it.candidates.length ? html`<option value="" disabled>──────────</option>${customers.filter((c) => !it.candidates.includes(c.id)).map((c) =>
      html`<option value="${c.id}">${c.line_name}</option>`)}` : ""}`;
  const accountOptions = (it) => {
    const c = byId.get(it.customer_id);
    if (!c) return html`<option value="">เลือกลูกค้าก่อน</option>`;
    if (!c.bank_accounts.length) return html`<option value="">ลูกค้านี้ยังไม่มีบัญชี</option>`;
    return c.bank_accounts.map((a) => html`<option value="${a.id}" ${a.id === it.bank_account_id ? raw("selected") : ""}>${bankName(a.bank_code)} ${acctFmt(a.account_number)}${a.account_name ? ` ${a.account_name}` : ""}</option>`);
  };
  const card = (it) => html`<div class="bulk-item" data-i="${it.i}">
    <div class="bulk-head"><span class="stamp" data-stamp></span><span class="bulk-msg" data-msg></span>
      <button type="button" class="x x-sm" data-remove aria-label="ไม่ส่งรายการนี้">×</button></div>
    <div class="bulk-src">${it.raw}</div>
    ${candidatePicker(it)}
    <div class="bulk-fields bp-fields">
      <div class="field"><label>ลูกค้า</label><select data-f="customer_id">${customerOptions(it)}</select></div>
      <div class="field"><label>บัญชีที่จะโอน</label><select data-f="bank_account_id">${accountOptions(it)}</select></div>
      <div class="field"><label>ยอดเงิน (บาท)</label><input type="number" min="0.01" step="0.01" inputmode="decimal" class="input-num" data-f="amount" value="${it.amount}"></div>
    </div>
    <div class="bulk-notes" data-notes hidden></div>
  </div>`;

  const evaluate = () => {
    const live = items.filter((x) => !x.removed);
    const perCustomer = new Map();
    for (const it of live) if (it.customer_id) perCustomer.set(it.customer_id, (perCustomer.get(it.customer_id) || 0) + 1);
    for (const it of items) {
      const c = byId.get(it.customer_id);
      const amt = Math.round(Number(it.amount) * 100) / 100;
      it.notes = [...it.parseNotes];
      // รายการที่ส่งไม่ได้ จะถูกตัดออกอัตโนมัติ และแจ้งให้ไปเพิ่มข้อมูลก่อน
      if (!c && it.candidates.length) {
        it.kind = "choose";
        it.msg = `ชื่อคล้ายลูกค้า ${it.candidates.length} คน ต้องเลือกให้ถูกคนก่อนส่ง`;
        continue;
      }
      if (!c) {
        it.kind = "skip";
        it.msg = it.candidates.length ? `ชื่อคล้ายลูกค้า ${it.candidates.length} คน เลือกให้ถูกคนถ้าจะส่ง` : "ยังไม่มีลูกค้าชื่อนี้ในระบบ";
        it.reason = it.candidates.length ? "ชื่อคล้ายลูกค้าหลายคน" : "ยังไม่มีลูกค้าในระบบ";
        continue;
      }
      if (!c.bank_accounts.length) { it.kind = "skip"; it.msg = "ลูกค้านี้ยังไม่มีบัญชี"; it.reason = "ลูกค้ายังไม่มีบัญชี"; continue; }
      if (!it.bank_account_id) { it.kind = "skip"; it.msg = "ยังไม่ได้เลือกบัญชี"; it.reason = "ยังไม่ได้เลือกบัญชี"; continue; }
      if (!(amt > 0)) { it.kind = "skip"; it.msg = "อ่านยอดเงินไม่ได้ ใส่ยอดถ้าจะส่ง"; it.reason = "อ่านยอดเงินไม่ได้"; continue; }
      it.kind = "ready"; it.msg = `ส่งให้ ${c.line_name}`;
      if (it.fuzzy && it.customer_id && normName(c.line_name) !== normName(it.name)) it.notes.push(`ชื่อในข้อความไม่ตรงทุกตัว จับคู่กับ ${c.line_name} ตรวจว่าถูกคน`);
      if (it.candidates.length && !it.exactIds.has(c.id)) it.notes.push(`เลือก ${c.line_name} ซึ่งชื่อไม่ตรงกับข้อความ "${it.name}" ตรวจอีกครั้งว่าถูกคน`);
      if (c.bank_accounts.length > 1) it.notes.push(`ลูกค้านี้มี ${c.bank_accounts.length} บัญชี เลือกบัญชีล่าสุดให้ ตรวจอีกครั้ง`);
      if (pending.some((p) => p.customer_id === c.id && Number(p.amount) === amt)) it.notes.push(`มีรายการรอโอน ${money(amt)} บาท ของลูกค้านี้อยู่แล้ว ระวังส่งซ้ำ`);
      if ((perCustomer.get(c.id) || 0) > 1) it.notes.push(`ลูกค้าคนนี้มี ${perCustomer.get(c.id)} รายการในชุดนี้`);
    }
  };

  openModal({
    title: "ตรวจรายการก่อนส่ง",
    wide: true,
    body: html`<div id="msg"></div>
      ${isOwner() ? html`<div class="bulk-line">ส่งในสาย <b>${lineName(lineId)}</b></div>` : ""}
      <div class="bulk-summary" id="bp-sum"></div>
      ${files.length ? html`<div class="bp-attached"><span class="label">แนบรูป ${files.length} รูป ส่งไปพร้อมรายการชุดนี้</span>
        <div class="img-grid img-grid-sm">${files.map((f) => html`<figure class="img-tile"><div class="img-thumb">
          <img src="${URL.createObjectURL(f)}" alt="รูปที่แนบ"></div></figure>`)}</div></div>` : ""}
      <div id="bp-skip"></div>
      <div class="bulk-list">${items.map(card)}</div>`,
    foot: html`<button type="button" class="btn btn-quiet" data-act="back">แก้ข้อความ</button>
      <button type="submit" class="btn btn-primary" id="bp-save">ส่ง</button>`,
    onMount: (form, close) => {
      const save = form.querySelector("#bp-save");
      const refresh = () => {
        evaluate();
        for (const it of items) {
          const el = form.querySelector(`.bulk-item[data-i="${it.i}"]`);
          el.classList.toggle("removed", it.removed);
          const st = el.querySelector("[data-stamp]");
          const [cls, label] = it.removed ? ["st-cancelled", "ไม่ส่ง"] : it.kind === "ready" ? ["st-confirmed", "พร้อมส่ง"]
            : it.kind === "choose" ? ["st-pending", "ต้องเลือก"] : ["st-returned", "ยังไม่ส่ง"];
          el.classList.toggle("must-choose", !it.removed && it.kind === "choose");
          st.className = `stamp ${cls}`; st.textContent = label;
          el.querySelector("[data-msg]").textContent = it.removed ? "กด ↺ เพื่อนำกลับมา" : it.msg;
          el.querySelector("[data-remove]").textContent = it.removed ? "↺" : "×";
          const notes = el.querySelector("[data-notes]");
          notes.hidden = it.removed || !it.notes.length;
          notes.innerHTML = it.notes.map((n) => html`<div>${n}</div>`).join("");
        }
        const live = items.filter((x) => !x.removed);
        const ready = live.filter((x) => x.kind === "ready");
        const skipped = live.filter((x) => x.kind === "skip");
        const choose = live.filter((x) => x.kind === "choose");
        const total = ready.reduce((sum, x) => sum + Math.round(Number(x.amount) * 100) / 100, 0);
        form.querySelector("#bp-sum").innerHTML = html`
          <span class="chip chip-new">พร้อมส่ง ${ready.length}</span>
          ${choose.length ? html`<span class="chip chip-choose">ต้องเลือกลูกค้า ${choose.length}</span>` : ""}
          ${skipped.length ? html`<span class="chip chip-fix">ยังไม่ส่ง ${skipped.length}</span>` : ""}
          <span class="chip chip-add">รวม ${money(total)} บาท</span>`.s;
        form.querySelector("#bp-skip").innerHTML = skipped.length ? notSentBox(skipped, "ระบบจะตัดรายการเหล่านี้ออก ส่งเฉพาะรายการที่พร้อม").s : "";
        // ชื่อคล้ายกันต้องเลือกให้ครบก่อน (หรือกด × ไม่ส่งรายการนั้น) จึงจะส่งได้
        save.textContent = choose.length ? `เลือกลูกค้าให้ครบก่อน (เหลือ ${choose.length} รายการ)`
          : ready.length ? `ส่ง ${ready.length} รายการ (${money(total)} บาท)` : "ไม่มีรายการที่ส่งได้";
        save.disabled = !ready.length || !!choose.length;
      };
      form.addEventListener("change", (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        const el = e.target.closest(".bulk-item");
        const it = items[Number(el.dataset.i)];
        it[f] = e.target.value;
        if (f === "customer_id") {
          it.fuzzy = false;
          // ให้ช่องเลือกและรายการชื่อคล้ายตรงกันเสมอ
          el.querySelector('select[data-f="customer_id"]').value = it.customer_id;
          el.querySelectorAll('input[data-f="customer_id"]').forEach((r) => { r.checked = r.value === it.customer_id; });
          it.bank_account_id = byId.get(it.customer_id)?.bank_accounts[0]?.id || "";
          el.querySelector('[data-f="bank_account_id"]').innerHTML = part(accountOptions(it));
        }
        refresh();
      });
      form.addEventListener("input", (e) => {
        if (e.target.dataset.f !== "amount") return;
        items[Number(e.target.closest(".bulk-item").dataset.i)].amount = e.target.value;
        refresh();
      });
      form.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-remove]");
        if (rm) { const it = items[Number(rm.closest(".bulk-item").dataset.i)]; it.removed = !it.removed; refresh(); }
        if (e.target.closest("[data-act=back]")) { close(); bulkPayoutModal(sourceText, lineId, files); }
      });
      refresh();
      form.onsubmit = (e) => {
        e.preventDefault();
        refresh();
        if (save.disabled) return;
        busy(save, async () => {
          const done = { sent: 0, total: 0, failed: [], images: 0, imageFailed: [] };
          // ส่งรูปก่อน แอดมินจะเห็นรูปพร้อมรายการทันที
          const batchId = uid().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
          if (files.length) {
            const up = await uploadImages(lineId, files, (n, all) => { save.textContent = `กำลังส่งรูป ${n}/${all}`; }, batchId);
            done.images = up.ok; done.imageFailed = up.failed;
          }
          const ready = items.filter((x) => !x.removed && x.kind === "ready");
          let n = 0;
          for (const it of ready) {
            save.textContent = `กำลังส่งรายการ ${++n}/${ready.length}`;
            const amount = Math.round(Number(it.amount) * 100) / 100;
            const { error } = await sb.rpc("create_payout", { p_bank_account_id: it.bank_account_id, p_amount: amount, p_note: null, p_batch_id: batchId });
            if (error) done.failed.push({ name: byId.get(it.customer_id)?.line_name || it.name, msg: errMsg(error) });
            else { done.sent++; done.total += amount; }
          }
          close();
          const notSent = items.filter((x) => !x.removed && x.kind === "skip");
          openModal({
            title: done.failed.length || notSent.length || done.imageFailed.length ? "ส่งแล้วบางส่วน" : "ส่งให้แอดมินแล้ว",
            body: html`<div class="bulk-summary">
                <span class="chip chip-new">ส่งแล้ว ${done.sent} รายการ</span>
                <span class="chip chip-add">รวม ${money(done.total)} บาท</span>
                ${notSent.length ? html`<span class="chip chip-fix">ยังไม่ส่ง ${notSent.length}</span>` : ""}
                ${done.images ? html`<span class="chip chip-add">แนบรูป ${done.images} รูป</span>` : ""}
                ${done.failed.length ? html`<span class="chip chip-fix">ไม่สำเร็จ ${done.failed.length}</span>` : ""}</div>
              ${done.imageFailed.length ? html`<div class="alert alert-warn"><b>ส่งรูปไม่สำเร็จ ${done.imageFailed.length} รูป</b> รายการส่งไปแล้ว แต่แอดมินจะไม่เห็นรูปเหล่านี้
                <ul class="bulk-result">${done.imageFailed.map((x) => html`<li>${x}</li>`)}</ul></div>` : ""}
              ${notSent.length ? notSentBox(notSent, "ยังไม่ได้ดำเนินการส่ง เพิ่มลูกค้าหรือบัญชีก่อน แล้ววางรายการเหล่านี้ส่งใหม่") : ""}
              ${done.failed.length ? html`<div class="alert alert-danger"><b>ส่งไม่สำเร็จ</b>
                <ul class="bulk-result">${done.failed.map((x) => html`<li><b>${x.name}</b> ${x.msg}</li>`)}</ul></div>` : ""}`,
            foot: html`<button type="button" class="btn btn-primary" data-close>เสร็จแล้ว</button>`,
          });
          session("myTab", "open");
          const view = document.getElementById("view");
          if (view && parseRoute().name === "my") viewMy(view, null, () => true).catch(() => {});
        });
      };
    },
  });
}
