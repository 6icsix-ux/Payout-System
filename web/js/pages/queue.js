// หน้าคิวโอน (แอดมินขึ้นไป)
import { PCOLS, sb } from "../core/config.js";
import { errMsg, money, scope } from "../core/format.js";
import { html } from "../core/html.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { busy, emptyBox, isModalOpen, meta, openModal, payoutEntry, showError, slip, toast } from "../core/ui.js";

export async function viewQueue(v, _id, alive) {
  const [pend, trans] = await Promise.all([
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "pending")).order("created_at").limit(300),
    // รายการค้างจากระบบเดิม (โอนแล้วแต่ยังไม่ยืนยัน)
    scope(sb.from("payout_requests").select(PCOLS).eq("status", "transferred")).order("transferred_at").limit(300),
  ]);
  if (!alive()) return;
  if (pend.error || trans.error) return showError(v, pend.error || trans.error);
  const pending = pend.data;
  const legacy = trans.data.filter((p) => p.transferred_by === state.me.id);
  const total = (rows) => money(rows.reduce((s, p) => s + Number(p.amount), 0));
  const sum = (rows) => html`<span class="sum">${rows.length} รายการ รวม <b>${total(rows)}</b> บาท</span>`;

  v.innerHTML = html`
  <div class="page-head"><h1>คิวโอน</h1>
    <button class="btn btn-sm" data-act="refresh">โหลดใหม่</button>
    <div class="page-meta"><span>อัปเดตเองทุก 20 วินาที</span></div></div>

  ${legacy.length ? html`
    <div class="section-head"><h2>ค้างยืนยันจากระบบเดิม</h2>${sum(legacy)}</div>
    <div class="ledger">${legacy.map((p) => payoutEntry(p, html`
      <button class="btn btn-primary" data-act="legacy" data-id="${p.id}">ยืนยันการโอน</button>`))}</div>` : ""}

  <div class="section-head"><h2>รอโอน</h2>${sum(pending)}</div>
  ${pending.length ? html`<div class="ledger">${pending.map((p) => payoutEntry(p, html`
      <button class="btn btn-sm btn-quiet btn-danger" data-act="return" data-id="${p.id}">ส่งกลับ</button>
      <button class="btn btn-primary" data-act="confirm" data-id="${p.id}">ยืนยันการโอน</button>`))}</div>`
    : emptyBox("ไม่มีรายการรอโอน", "รายการใหม่จากสมาชิกจะขึ้นที่นี่")}`.s;

  const all = [...pending, ...trans.data];
  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "refresh") return route();
    const p = all.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "confirm") confirmModal(p, "confirm_payout", { p_id: p.id, p_version: p.version });
    if (b.dataset.act === "legacy") confirmModal(p, "confirm_transfer", { p_id: p.id });
    if (b.dataset.act === "return") returnModal(p);
  };
  state.timer = setInterval(() => { if (!isModalOpen() && alive()) route(); }, 20000);
}

// ยืนยันการโอนขั้นตอนเดียว: ดูสลิป โอนในแอปธนาคาร ติ๊กว่าตรวจแล้ว กดยืนยัน
export function confirmModal(p, fn, args) {
  openModal({
    title: "ยืนยันการโอน",
    body: html`${slip(p)}
      <label class="check-line"><input type="checkbox" name="ok">
        <span>โอนแล้ว และตรวจกับแอปธนาคารแล้ว ชื่อ เลขบัญชี และยอดเงินตรงกัน</span></label>
      <p class="small-print">ยืนยันแล้วแก้ไขไม่ได้อีก</p>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยังไม่โอน</button>
      <button type="submit" class="btn btn-primary btn-lg" disabled>ยืนยันการโอน</button>`,
    onMount: (form, close) => {
      const submit = form.querySelector("[type=submit]");
      form.ok.onchange = () => { submit.disabled = !form.ok.checked; };
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!form.ok.checked) return;
        busy(submit, async () => {
          const { error } = await sb.rpc(fn, args);
          close();
          if (error) { toast(errMsg(error), true); return route(); }
          toast(`ยืนยันการโอน ${money(p.amount)} บาท แล้ว`); route();
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
