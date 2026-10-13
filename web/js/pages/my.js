// หน้ารายการของฉัน
import { PCOLS, sb } from "../core/config.js";
import { acctFmt, bankName, errMsg, money, session } from "../core/format.js";
import { amountFields, readAmount } from "../core/forms.js";
import { html, raw } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, confirmBox, emptyBox, isRecalled, meta, openModal, payoutEntry, returnText, showError, toast } from "../core/ui.js";
import { bulkPayoutModal } from "./bulk-payout.js";

export async function viewMy(v, _id, alive) {
  const tab = session("myTab") || "open";
  const TABS = [["open", "รอโอน"], ["returned", "ส่งกลับแก้ไข"], ["done", "โอนแล้ว"], ["cancelled", "ยกเลิก"], ["all", "ทั้งหมด"]];
  const { data, error } = await sb.from("payout_requests").select(PCOLS)
    .eq("created_by", state.me.id).order("created_at", { ascending: false }).limit(200);
  if (!alive()) return;
  if (error) return showError(v, error);

  const match = {
    open: (p) => p.status === "pending",
    returned: (p) => p.status === "returned",
    done: (p) => p.status === "transferred" || p.status === "confirmed",
    cancelled: (p) => p.status === "cancelled",
    all: () => true,
  };
  const rows = data.filter(match[tab]);
  const counts = Object.fromEntries(TABS.map(([k]) => [k, data.filter(match[k]).length]));

  v.innerHTML = html`
  <div class="page-head"><h1>รายการของฉัน</h1>
    <button class="btn btn-primary" data-act="bulk-pay">${svg(ICON.paste, 18)}แจ้งโอนหลายราย</button>
    <div class="page-meta"><span>รายการที่คุณส่ง 200 รายการล่าสุด</span></div></div>
  <div class="tabs" role="tablist">${TABS.map(([k, label]) => html`<button class="tab ${k === tab ? "active" : ""}" data-tab="${k}" role="tab">${label}${
    k !== "all" && counts[k] ? html`<span class="n">${counts[k]}</span>` : ""}</button>`)}</div>
  ${counts.returned && tab !== "returned" ? raw(alertBox("danger", html`มี ${counts.returned} รายการรอคุณแก้ไขแล้วส่งใหม่ <a href="#" data-tab="returned">ดูรายการ</a>`)) : ""}
  ${rows.length ? html`<div class="ledger">${rows.map((p) => payoutEntry(p,
      p.status === "pending" ? html`
        <button class="btn btn-sm btn-quiet btn-danger" data-act="cancel" data-id="${p.id}">ยกเลิก</button>
        <button class="btn btn-sm" data-act="recall" data-id="${p.id}">ดึงกลับมาแก้</button>`
      : p.status === "returned" ? html`
        <button class="btn btn-sm btn-quiet btn-danger" data-act="cancel" data-id="${p.id}">ยกเลิก</button>
        <button class="btn btn-sm btn-primary" data-act="edit" data-id="${p.id}">แก้แล้วส่งใหม่</button>` : ""))}</div>`
    : emptyBox("ไม่มีรายการในหมวดนี้")}`.s;

  v.onclick = (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { e.preventDefault(); session("myTab", t.dataset.tab); return route(); }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "bulk-pay") return bulkPayoutModal();
    const p = data.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "edit") editPayoutModal(p);
    if (b.dataset.act === "recall") {
      busy(b, async () => {
        const { error: err } = await sb.rpc("recall_payout", { p_id: p.id });
        if (err) { toast(errMsg(err), true); return route(); }
        toast("ดึงกลับแล้ว แอดมินจะไม่เห็นรายการนี้จนกว่าคุณส่งใหม่");
        session("myTab", "returned");
        await route();
        editPayoutModal({ ...p, status: "returned", returned_by: state.me.id, created_by: state.me.id });
      });
    }
    if (b.dataset.act === "cancel") {
      confirmBox("ยกเลิกรายการนี้?", `${money(p.amount)} บาท ให้ ${p.customer_line_name} จะถูกยกเลิก และแอดมินจะไม่เห็นในคิวโอน`, "ยกเลิกรายการ", async () => {
        const { error: err } = await sb.rpc("cancel_payout", { p_id: p.id });
        if (err) { toast(errMsg(err), true); return false; }
        toast("ยกเลิกรายการแล้ว"); route(); return true;
      }, true);
    }
  };
}

export async function editPayoutModal(p) {
  const { data: accounts } = await sb.from("bank_accounts").select("*").eq("customer_id", p.customer_id).order("created_at");
  const returned = p.status === "returned";
  openModal({
    title: returned ? "แก้แล้วส่งใหม่" : "แก้ไขรายการ",
    body: html`<div id="msg"></div>
      ${returned ? raw(alertBox(isRecalled(p) ? "info" : "danger", returnText(p))) : ""}
      <div class="field"><span class="label">ลูกค้า</span><div class="readonly-value">${p.customer_line_name}</div></div>
      <div class="field"><label for="f-acct">บัญชีที่จะโอน</label><select id="f-acct" name="acct">${(accounts || []).map((a) => html`
        <option value="${a.id}" ${a.id === p.bank_account_id ? raw("selected") : ""}>${bankName(a.bank_code)} ${acctFmt(a.account_number)} ${a.account_name || ""}</option>`)}</select></div>
      ${amountFields(p.amount)}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ปิด</button>
      <button type="submit" class="btn btn-primary">${returned ? "ส่งใหม่" : "บันทึกการแก้ไข"}</button>`,
    onMount: (form, close) => {
      form.note.value = p.note || "";
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = readAmount(form);
        if (!amount) return (form.querySelector("#msg").innerHTML = alertBox("danger", "ใส่ยอดเงินมากกว่า 0"));
        busy(form.querySelector("[type=submit]"), async () => {
          const { error } = await sb.rpc("edit_payout", { p_id: p.id, p_bank_account_id: form.acct.value, p_amount: amount, p_note: form.note.value });
          if (error) return (form.querySelector("#msg").innerHTML = alertBox("danger", errMsg(error)));
          close(); toast(returned ? "ส่งใหม่แล้ว" : "บันทึกการแก้ไขแล้ว"); route();
        });
      };
    },
  });
}
