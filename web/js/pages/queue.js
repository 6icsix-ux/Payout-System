// หน้าคิวโอน (แอดมินขึ้นไป)
import { PCOLS, sb } from "../core/config.js";
import { acctFmt, bankName, clock, errMsg, money, scope } from "../core/format.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { gallery, handleGalleryClick, loadBatchImages } from "../core/images.js";
import { copyText, busy, emptyBox, isModalOpen, meta, openModal, payoutEntry, showError, slip, toast } from "../core/ui.js";

// รีเฟรชคิวอัตโนมัติทุก 1 นาที และหยุดเมื่อไม่ได้ดูหน้าจอ (พับจอ/สลับแท็บ) เพื่อลด log ของ Supabase
const REFRESH_MS = 60000;

// แตะรายการเพื่อคัดลอกเลขบัญชี (ใช้ทั้งในหน้าคิวและหน้าต่างยืนยันหลายรายการ)
function copyRow(el) {
  copyText(el.dataset.copyAcct, null).then((ok) => {
    if (ok === false) return;
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 900);
    toast(`คัดลอกเลขบัญชี ${el.dataset.copyAcct} แล้ว`);
  });
}

// รายการที่ติ๊กเลือกไว้ (เก็บไว้ข้ามการรีเฟรชอัตโนมัติ)
const picked = new Set();

// ปุ่มยืนยันใต้รายการแต่ละกลุ่ม: ไม่ติ๊กเลย = ยืนยันทั้งกลุ่ม, ติ๊กไว้ = ยืนยันเฉพาะที่ติ๊ก
const confirmAllBar = (rows, kind = "pending") => html`<div class="confirm-bar">
  <span class="confirm-sum">${rows.length} รายการ รวม <b class="num">${money(rows.reduce((s, x) => s + Number(x.amount), 0))}</b> บาท</span>
  <button type="button" class="btn btn-quiet btn-sm" data-act="clear-pick" hidden>ล้างที่เลือก</button>
  <button class="btn btn-primary btn-lg" data-act="confirm-all" data-kind="${kind}" data-ids="${rows.map((x) => x.id).join(",")}">ยืนยันการโอนทั้งหมด</button>
</div>`;

// อัปเดตแถบยืนยันของกลุ่มตามรายการที่ติ๊ก
function syncGroup(g) {
  const boxes = [...g.querySelectorAll("[data-pick]")];
  const on = boxes.filter((b) => b.checked);
  boxes.forEach((b) => b.closest(".entry")?.classList.toggle("picked", b.checked));
  const sumEl = g.querySelector(".confirm-sum");
  const btn = g.querySelector("[data-act=confirm-all]");
  const clear = g.querySelector("[data-act=clear-pick]");
  if (!sumEl || !btn) return;
  const amt = (list) => money(list.reduce((s, b) => s + Number(b.dataset.amt), 0));
  if (on.length) {
    sumEl.innerHTML = html`เลือก <b class="num">${on.length}</b> จาก ${boxes.length} รายการ รวม <b class="num">${amt(on)}</b> บาท`.s;
    btn.textContent = `ยืนยันที่เลือก ${on.length} รายการ`;
    clear.hidden = false;
  } else {
    sumEl.innerHTML = html`${boxes.length} รายการ รวม <b class="num">${amt(boxes)}</b> บาท`.s;
    btn.textContent = "ยืนยันการโอนทั้งหมด";
    clear.hidden = true;
  }
}

const rowsOf = (rows, actions) => html`<div class="ledger">${rows.map((p) =>
  payoutEntry(p, actions(p), { link: false, copy: true, pick: { checked: picked.has(p.id) } }))}</div>`;

// จัดรายการเป็นกลุ่มตามชุดที่ส่ง: ชุดที่มีรูปแนบ แสดงรูปก่อน แล้วรายการของชุด และปุ่มยืนยันทั้งชุด
// รายการที่ไม่มีรูป รวมเป็นกลุ่มเดียว มีปุ่มยืนยันทั้งหมดอยู่ด้านล่าง
function withBatches(rows, byBatch, actions) {
  const plain = rows.filter((p) => !(p.batch_id && byBatch[p.batch_id]?.length));
  const batches = [];
  const seen = new Set();
  for (const p of rows) {
    if (!p.batch_id || !byBatch[p.batch_id]?.length || seen.has(p.batch_id)) continue;
    seen.add(p.batch_id);
    batches.push(rows.filter((x) => x.batch_id === p.batch_id));
  }
  return html`
    ${batches.map((group) => {
      const p = group[0];
      const pics = byBatch[p.batch_id];
      return html`<section class="batch" data-group>
        <div class="batch-head">
          <b>ชุดจาก ${p.creator?.display_name || "สมาชิก"}</b>
          <span>${clock(p.created_at)}</span>
          <span>รูป ${pics.length} รูป ตรวจว่าตรงกับรายการ</span>
        </div>
        ${gallery(pics, { showUploader: false })}
        ${rowsOf(group, actions)}
        ${confirmAllBar(group)}
      </section>`;
    })}
    ${plain.length ? html`<div class="plain-group" data-group>${rowsOf(plain, actions)}${confirmAllBar(plain)}</div>` : ""}`;
}

export async function viewQueue(v, _id, alive) {
  const [pend, trans] = await Promise.all([
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "pending")).order("created_at").limit(300),
    // รายการค้างจากระบบเดิม (โอนแล้วแต่ยังไม่ยืนยัน)
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "transferred")).order("transferred_at").limit(300),
  ]);
  if (!alive()) return;
  if (pend.error || trans.error) return showError(v, pend.error || trans.error);
  // รูปที่แนบมากับชุดรายการ (แสดงเหนือรายการของชุดนั้น)
  const imgs = await loadBatchImages([...pend.data, ...trans.data].map((p) => p.batch_id));
  if (!alive()) return;
  const byBatch = imgs.byBatch;
  const images = Object.values(byBatch).flat();
  const pending = pend.data;
  const legacy = trans.data.filter((p) => p.transferred_by === state.me.id);
  const total = (rows) => money(rows.reduce((s, p) => s + Number(p.amount), 0));
  const pendingActions = (p) => html`
      <button class="btn btn-sm btn-quiet btn-danger" data-act="return" data-id="${p.id}">ส่งกลับ</button>`;
  const legacyActions = () => "";
  const sum = (rows) => html`<span class="sum">${rows.length} รายการ รวม <b>${total(rows)}</b> บาท</span>`;

  v.innerHTML = html`
  <div class="page-head"><h1>คิวโอน</h1>
    <button class="btn btn-sm" data-act="refresh">โหลดใหม่</button>
    <div class="page-meta"><span>อัปเดตเองทุก 1 นาที (หยุดเมื่อไม่ได้เปิดดู)</span><span>แตะกล่องรายละเอียดเพื่อคัดลอกเลขบัญชี</span><span>แตะช่องว่างของแถวหรือช่องติ๊กเพื่อเลือกยืนยันเฉพาะบางรายการ</span></div></div>

  ${imgs.error ? html`<div class="alert alert-warn">โหลดรูปที่แนบมาไม่สำเร็จ กดโหลดใหม่</div>` : ""}

  ${legacy.length ? html`
    <div class="section-head"><h2>ค้างยืนยันจากระบบเดิม</h2>${sum(legacy)}</div>
    <div class="plain-group" data-group>${rowsOf(legacy, legacyActions)}${confirmAllBar(legacy, "legacy")}</div>` : ""}

  <div class="section-head"><h2>รอโอน</h2>${sum(pending)}</div>
  ${pending.length ? withBatches(pending, byBatch, pendingActions)
    : emptyBox("ไม่มีรายการรอโอน", "รายการใหม่จากสมาชิกจะขึ้นที่นี่")}`.s;

  const all = [...pending, ...trans.data];
  // ลืมรายการที่ไม่อยู่ในคิวแล้ว แล้ววาดแถบยืนยันตามที่ติ๊กค้างไว้
  const live = new Set([...pending, ...legacy].map((p) => p.id));
  for (const id of [...picked]) if (!live.has(id)) picked.delete(id);
  v.querySelectorAll("[data-group]").forEach(syncGroup);
  v.onchange = (e) => {
    const box = e.target.closest("[data-pick]");
    if (!box) return;
    if (box.checked) picked.add(box.dataset.pick); else picked.delete(box.dataset.pick);
    syncGroup(box.closest("[data-group]"));
  };
  v.onclick = (e) => {
    if (handleGalleryClick(e, images, () => route())) return;
    const b = e.target.closest("[data-act]");
    if (!b) {
      const acct = e.target.closest("[data-copy-acct]");
      if (acct) return copyRow(acct);
      // แตะตรงไหนของแถวก็ติ๊ก/เอาติ๊กออก (ช่องติ๊กเองจัดการโดยเบราว์เซอร์)
      if (e.target.closest(".pick-lead")) return;
      const box = e.target.closest(".entry.pickable")?.querySelector("[data-pick]");
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); }
      return;
    }
    if (b.dataset.act === "refresh") return route();
    if (b.dataset.act === "clear-pick") {
      const g = b.closest("[data-group]");
      g.querySelectorAll("[data-pick]").forEach((x) => { x.checked = false; picked.delete(x.dataset.pick); });
      return syncGroup(g);
    }
    if (b.dataset.act === "confirm-all") {
      // ติ๊กไว้ = ยืนยันเฉพาะที่ติ๊ก, ไม่ติ๊กเลย = ยืนยันทั้งกลุ่ม
      const g = b.closest("[data-group]");
      const chosen = [...g.querySelectorAll("[data-pick]:checked")].map((x) => x.dataset.pick);
      const ids = chosen.length ? chosen : b.dataset.ids.split(",");
      return confirmAllModal(all.filter((x) => ids.includes(x.id)), b.dataset.kind);
    }
    const p = all.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "return") returnModal(p);
  };
  v.onkeydown = (e) => {
    const row = e.target.closest?.("[data-copy-acct]");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); copyRow(row); }
  };
  const loadedAt = Date.now();
  const refresh = () => { if (alive() && !document.hidden && !isModalOpen()) route(); };
  state.timer = setInterval(refresh, REFRESH_MS);
  // กลับมาดูหน้าจอหลังหายไปนานกว่า 1 นาที โหลดใหม่ทันที
  const onVisible = () => { if (!document.hidden && Date.now() - loadedAt >= REFRESH_MS) refresh(); };
  document.addEventListener("visibilitychange", onVisible);
  state.cleanup = () => document.removeEventListener("visibilitychange", onVisible);
}

// ยืนยันการโอนทั้งกลุ่ม: แสดงสรุปทุกรายการ ติ๊กว่าโอนครบแล้ว แล้วยืนยันทีละรายการ
export function confirmAllModal(rows, kind = "pending") {
  const totalAmt = rows.reduce((s, x) => s + Number(x.amount), 0);
  openModal({
    title: `ยืนยันการโอน ${rows.length} รายการ`,
    wide: true,
    body: html`<div class="confirm-list">${rows.map((p) => html`<div class="confirm-row copyable" data-copy-acct="${p.account_number}" role="button" tabindex="0" title="แตะเพื่อคัดลอกเลขบัญชี">
        <span class="nm">${p.customer_line_name}</span>
        <span class="bk"><span class="bank">${bankName(p.bank_code)}</span> <span class="num">${acctFmt(p.account_number)}</span>
          <span class="copy-ico">${svg(ICON.copy, 15)}</span></span>
        <span class="am num">${money(p.amount)}</span></div>`)}</div>
      <p class="small-print confirm-hint">${svg(ICON.copy, 14)} แตะรายการเพื่อคัดลอกเลขบัญชี</p>
      <div class="confirm-total"><span>รวม ${rows.length} รายการ</span><span class="num">${money(totalAmt)} <small>บาท</small></span></div>
      <label class="check-line"><input type="checkbox" name="ok">
        <span>โอนครบทุกรายการแล้ว และตรวจกับแอปธนาคารแล้ว ชื่อ เลขบัญชี และยอดเงินตรงกัน</span></label>
      <p class="small-print">ยืนยันแล้วแก้ไขไม่ได้อีก ถ้ามีรายการที่ยังไม่ได้โอน ให้กดส่งกลับรายการนั้นก่อน</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยังไม่โอน</button>
      <button type="submit" class="btn btn-primary btn-lg" disabled>ยืนยันการโอน ${rows.length} รายการ</button>`,
    onMount: (form, close) => {
      const submit = form.querySelector("[type=submit]");
      form.ok.onchange = () => { submit.disabled = !form.ok.checked; };
      const list = form.querySelector(".confirm-list");
      list.onclick = (e) => { const row = e.target.closest("[data-copy-acct]"); if (row) copyRow(row); };
      list.onkeydown = (e) => {
        const row = e.target.closest("[data-copy-acct]");
        if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); copyRow(row); }
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!form.ok.checked) return;
        busy(submit, async () => {
          const failed = [];
          let ok = 0, n = 0;
          for (const p of rows) {
            submit.textContent = `กำลังยืนยัน ${++n}/${rows.length}`;
            const { error } = kind === "legacy"
              ? await sb.rpc("confirm_transfer", { p_id: p.id })
              : await sb.rpc("confirm_payout", { p_id: p.id, p_version: p.version });
            if (error) failed.push(`${p.customer_line_name} ${money(p.amount)}: ${errMsg(error)}`);
            else { ok++; picked.delete(p.id); }
          }
          close();
          if (failed.length) toast(`ยืนยันแล้ว ${ok} รายการ ไม่สำเร็จ ${failed.length}: ${failed[0]}`, true);
          else toast(`ยืนยันการโอน ${ok} รายการ แล้ว`);
          route();
        });
      };
    },
  });
}

export function returnModal(p) {
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
