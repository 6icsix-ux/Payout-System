// หน้ารายงานรายวัน
import { PCOLS, sb } from "../core/config.js";
import { acctFmt, bankName, clock, dayFmt, isOwner, lineName, money, ownerLine, scope, session, shiftDay, thaiDate, todayBkk } from "../core/format.js";
import { html, raw } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { emptyBox, meta, showError, stamp } from "../core/ui.js";

export async function viewReport(v, _id, alive) {
  const day = session("reportDay") || todayBkk();
  const from = `${day}T00:00:00+07:00`;
  const to = `${shiftDay(day, 1)}T00:00:00+07:00`;
  const { data, error } = await scope(sb.from("payout_requests").select(PCOLS)
    .in("status", ["transferred", "confirmed"]).gte("transferred_at", from).lt("transferred_at", to))
    .order("transferred_at");
  if (!alive()) return;
  if (error) return showError(v, error);

  const sum = data.reduce((s, p) => s + Number(p.amount), 0);
  const confirmed = data.filter((p) => p.status === "confirmed").length;
  const showLine = isOwner() && !ownerLine();
  const isToday = day >= todayBkk();

  v.innerHTML = html`
  <div class="page-head"><h1>รายงานรายวัน</h1>
    <div class="day-nav">
      <button class="btn btn-sm" data-day="-1" aria-label="วันก่อนหน้า">${svg(ICON.back, 16)}</button>
      <label class="date-pick">${svg(ICON.report, 18)}<span>${thaiDate(day)}</span>
        <input type="date" id="day" value="${day}" max="${todayBkk()}" aria-label="เลือกวันที่"></label>
      <button class="btn btn-sm" data-day="1" aria-label="วันถัดไป" ${isToday ? raw("disabled") : ""} style="transform:scaleX(-1)">${svg(ICON.back, 16)}</button>
    </div>
    <div class="page-meta"><span>${dayFmt.format(new Date(day + "T12:00:00+07:00"))}</span>${ownerLine() ? html`<span>${lineName(ownerLine())}</span>` : ""}</div>
  </div>

  <div class="daybar">
    <div class="total"><div class="k">ยอดโอนรวมของวัน</div><div class="v">${money(sum)}<small>บาท</small></div></div>
    <div class="stat"><div class="k">รายการ</div><div class="v">${data.length}</div></div>
    <div class="stat"><div class="k">ยืนยันแล้ว</div><div class="v">${confirmed}/${data.length}</div></div>
  </div>

  ${data.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>เวลา</th>${showLine ? html`<th>สาย</th>` : ""}<th>ลูกค้า</th><th>บัญชีปลายทาง</th>
      <th class="r">ยอด (บาท)</th><th>ผู้โอน</th><th>สถานะ</th></tr></thead>
    <tbody>${data.map((p) => html`<tr>
      <td class="num" data-label="เวลา">${clock(p.transferred_at)}</td>
      ${showLine ? html`<td data-label="สาย">${lineName(p.line_id)}</td>` : ""}
      <td data-label="ลูกค้า">${p.customer_line_name}</td>
      <td data-label="บัญชี"><div><span class="bank">${bankName(p.bank_code)}</span> <span class="num">${acctFmt(p.account_number)}</span></div>
        <div class="meta" style="margin-top:2px">${p.account_name || "ไม่ระบุชื่อบัญชี"}</div></td>
      <td class="r amount" style="font-size:16px" data-label="ยอด (บาท)">${money(p.amount)}</td>
      <td data-label="ผู้โอน">${p.transferrer?.display_name || ""}</td>
      <td data-label="สถานะ">${stamp(p.status)}</td></tr>`)}</tbody></table></div>`
    : emptyBox("ไม่มีการโอนในวันนี้", "เลือกวันอื่นจากปฏิทินด้านบน")}`.s;

  const setDay = (d) => { session("reportDay", d); route(); };
  const dayInput = v.querySelector("#day");
  dayInput.onchange = (e) => e.target.value && setDay(e.target.value);
  // เปิดปฏิทินเมื่อกดตรงไหนก็ได้บนป้ายวันที่
  dayInput.onclick = () => { try { dayInput.showPicker(); } catch { /* เบราว์เซอร์เก่าเปิดเองจากการแตะ */ } };
  v.onclick = (e) => {
    const b = e.target.closest("[data-day]");
    if (b && !b.disabled) setDay(shiftDay(day, Number(b.dataset.day)));
  };
}
