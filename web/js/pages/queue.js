// หน้าคิวโอน (แอดมินขึ้นไป)
import { PCOLS, sb } from "../core/config.js";
import { acctFmt, bankName, clock, errMsg, money, scope } from "../core/format.js";
import { html } from "../core/html.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { gallery, handleGalleryClick, loadBatchImages } from "../core/images.js";
import { copyText, busy, emptyBox, isModalOpen, meta, openModal, payoutEntry, showError, slip, toast } from "../core/ui.js";

// ปุ่มยืนยันทั้งหมดใต้รายการแต่ละกลุ่ม
const confirmAllBar = (rows, kind = "pending") => html`<div class="confirm-bar">
  <span>${rows.length} รายการ รวม <b class="num">${money(rows.reduce((s, x) => s + Number(x.amount), 0))}</b> บาท</span>
  <button class="btn btn-primary btn-lg" data-act="confirm-all" data-kind="${kind}" data-ids="${rows.map((x) => x.id).join(",")}">ยืนยันการโอนทั้งหมด</button>
</div>`;

const rowsOf = (rows, actions) => html`<div class="ledger">${rows.map((p) => payoutEntry(p, actions(p), { link: false, copy: true }))}</div>`;

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
      return html`<section class="batch">
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
    ${plain.length ? html`<div class="plain-group">${rowsOf(plain, actions)}${confirmAllBar(plain)}</div>` : ""}`;
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
  const sum = (rows) => html`<span class="sum">${rows.length} รายการ รวม <b>${total(rows)}</b> บาท</span>`;

  v.innerHTML = html`
  <div class="page-head"><h1>คิวโอน</h1>
    <button class="btn btn-sm" data-act="refresh">โหลดใหม่</button>
    <div class="page-meta"><span>อัปเดตเองทุก 20 วินาที</span><span>แตะรายการเพื่อคัดลอกเลขบัญชี</span></div></div>

  ${imgs.error ? html`<div class="alert alert-warn">โหลดรูปที่แนบมาไม่สำเร็จ กดโหลดใหม่</div>` : ""}

  ${legacy.length ? html`
    <div class="section-head"><h2>ค้างยืนยันจากระบบเดิม</h2>${sum(legacy)}</div>
    <div class="plain-group">${rowsOf(legacy, () => "")}${confirmAllBar(legacy, "legacy")}</div>` : ""}

  <div class="section-head"><h2>รอโอน</h2>${sum(pending)}</div>
  ${pending.length ? withBatches(pending, byBatch, pendingActions)
    : emptyBox("ไม่มีรายการรอโอน", "รายการใหม่จากสมาชิกจะขึ้นที่นี่")}`.s;

  const all = [...pending, ...trans.data];
  const copyRow = (el) => {
    copyText(el.dataset.copyAcct, null).then((ok) => {
      if (ok === false) return;
      el.classList.add("copied");
      setTimeout(() => el.classList.remove("copied"), 900);
      toast(`คัดลอกเลขบัญชี ${el.dataset.copyAcct} แล้ว`);
    });
  };
  v.onclick = (e) => {
    if (handleGalleryClick(e, images, () => route())) return;
    const b = e.target.closest("[data-act]");
    if (!b) {
      const row = e.target.closest("[data-copy-acct]");
      if (row) copyRow(row);
      return;
    }
    if (b.dataset.act === "refresh") return route();
    if (b.dataset.act === "confirm-all") {
      const ids = b.dataset.ids.split(",");
      return confirmAllModal(all.filter((x) => ids.includes(x.id)), b.dataset.kind);
    }
    const p = all.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "return") returnModal(p);
  };
  v.onkeydown = (e) => {
    const row = e.target.closest?.("[data-copy-acct]");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); copyRow(row); }
  };
  state.timer = setInterval(() => { if (!isModalOpen() && alive()) route(); }, 20000);
}

// ยืนยันการโอนทั้งกลุ่ม: แสดงสรุปทุกรายการ ติ๊กว่าโอนครบแล้ว แล้วยืนยันทีละรายการ
export function confirmAllModal(rows, kind = "pending") {
  const totalAmt = rows.reduce((s, x) => s + Number(x.amount), 0);
  openModal({
    title: `ยืนยันการโอน ${rows.length} รายการ`,
    wide: true,
    body: html`<div class="confirm-list">${rows.map((p) => html`<div class="confirm-row">
        <span class="nm">${p.customer_line_name}</span>
        <span class="bk"><span class="bank">${bankName(p.bank_code)}</span> <span class="num">${acctFmt(p.account_number)}</span></span>
        <span class="am num">${money(p.amount)}</span></div>`)}</div>
      <div class="confirm-total"><span>รวม ${rows.length} รายการ</span><span class="num">${money(totalAmt)} <small>บาท</small></span></div>
      <label class="check-line"><input type="checkbox" name="ok">
        <span>โอนครบทุกรายการแล้ว และตรวจกับแอปธนาคารแล้ว ชื่อ เลขบัญชี และยอดเงินตรงกัน</span></label>
      <p class="small-print">ยืนยันแล้วแก้ไขไม่ได้อีก ถ้ามีรายการที่ยังไม่ได้โอน ให้กดส่งกลับรายการนั้นก่อน</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยังไม่โอน</button>
      <button type="submit" class="btn btn-primary btn-lg" disabled>ยืนยันการโอน ${rows.length} รายการ</button>`,
    onMount: (form, close) => {
      const submit = form.querySelector("[type=submit]");
      form.ok.onchange = () => { submit.disabled = !form.ok.checked; };
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
            else ok++;
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
