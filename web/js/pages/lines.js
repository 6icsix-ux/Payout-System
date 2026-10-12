// หน้าสาย (เจ้าของเว็บ)
import { sb } from "../core/config.js";
import { errMsg } from "../core/format.js";
import { html } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, emptyBox, meta, openModal, toast } from "../core/ui.js";

export async function viewLines(v, _id, alive) {
  const [{ data: profiles }, counts] = await Promise.all([
    sb.from("profiles").select("line_id,role,is_active").neq("role", "owner"),
    Promise.all(state.lines.map((l) =>
      sb.from("customers").select("id", { count: "exact", head: true }).eq("line_id", l.id).then((r) => r.count || 0))),
  ]);
  if (!alive()) return;
  const people = (lineId, role) => (profiles || []).filter((p) => p.line_id === lineId && p.role === role && p.is_active).length;

  v.innerHTML = html`
  <div class="page-head"><h1>สาย</h1><button class="btn btn-primary" data-act="create">${svg(ICON.plus, 18)}สร้างสาย</button>
    <div class="page-meta"><span>สร้างผู้ดูแลของแต่ละสายได้ที่หน้าผู้ใช้ สายละไม่เกิน 2 คน</span></div></div>
  ${state.lines.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>สาย</th><th class="r">ผู้ดูแล</th><th class="r">แอดมิน</th><th class="r">สมาชิก</th><th class="r">ลูกค้า</th><th></th></tr></thead>
    <tbody>${state.lines.map((l, i) => html`<tr>
      <td class="cell-title"><b>${l.name}</b></td>
      <td class="r num" data-label="ผู้ดูแล">${people(l.id, "supervisor")}/2</td>
      <td class="r num" data-label="แอดมิน">${people(l.id, "admin")}</td>
      <td class="r num" data-label="สมาชิก">${people(l.id, "member")}</td>
      <td class="r num" data-label="ลูกค้า">${counts[i]}</td>
      <td class="r cell-actions"><button class="btn btn-sm btn-quiet" data-act="rename" data-id="${l.id}">เปลี่ยนชื่อ</button></td></tr>`)}</tbody>
  </table></div>` : emptyBox("ยังไม่มีสาย", "สร้างสายแรก แล้วสร้างผู้ดูแลของสายที่หน้าผู้ใช้")}`.s;

  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const line = state.lines.find((l) => l.id === b.dataset.id);
    openModal({
      title: line ? "เปลี่ยนชื่อสาย" : "สร้างสาย",
      body: html`<div id="msg"></div><div class="field"><label for="f-lt">ชื่อสาย</label>
        <input id="f-lt" type="text" name="line_title" value="${line?.name || ""}" maxlength="60" required></div>`,
      foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">${line ? "บันทึกชื่อ" : "สร้างสาย"}</button>`,
      onMount: (form, close) => {
        form.onsubmit = (ev) => {
          ev.preventDefault();
          const name = form.line_title.value.trim();
          if (!name) return;
          busy(form.querySelector("[type=submit]"), async () => {
            const { error } = line
              ? await sb.from("lines").update({ name }).eq("id", line.id)
              : await sb.from("lines").insert({ name });
            if (error) {
              form.querySelector("#msg").innerHTML = alertBox("danger", error.code === "23505" ? "ชื่อสายนี้มีแล้ว" : errMsg(error));
              return;
            }
            const { data } = await sb.from("lines").select("id,name").order("name");
            state.lines = data || [];
            close(); toast(line ? "บันทึกชื่อสายแล้ว" : "สร้างสายแล้ว"); route();
          });
        };
      },
    });
  };
}
