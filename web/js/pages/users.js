// หน้าผู้ใช้ (ผู้ดูแลขึ้นไป)
import { FUNCTION_NAME, RANK, ROLE_TH, sb } from "../core/config.js";
import { isOwner, lineName, ownerLine, scope } from "../core/format.js";
import { html, raw } from "../core/html.js";
import { ICON, svg } from "../core/icons.js";
import { route } from "../core/router.js";
import { state } from "../core/state.js";
import { alertBox, busy, confirmBox, emptyBox, lineOptions, meta, openModal, showError, toast } from "../core/ui.js";

export async function manageUser(body) {
  const { data, error } = await sb.functions.invoke(FUNCTION_NAME, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    if (/Failed to send/i.test(msg)) msg = `ติดต่อ Edge Function "${FUNCTION_NAME}" ไม่ได้ ตรวจชื่อฟังก์ชันใน config.js`;
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function genPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

export function canManage(u) {
  if (u.id === state.me.id || u.role === "owner") return false;
  if (isOwner()) return true;
  return state.me.role === "supervisor" && ["admin", "member"].includes(u.role) && u.line_id === state.me.line_id;
}

export async function viewUsers(v, _id, alive) {
  const { data, error } = await scope(sb.from("profiles")
    .select("id,username,display_name,role,line_id,is_active,created_at").neq("role", "owner"));
  if (!alive()) return;
  if (error) return showError(v, error);
  const users = data.sort((a, b) => (RANK[b.role] - RANK[a.role]) || a.display_name.localeCompare(b.display_name, "th"));
  const showLine = isOwner() && !ownerLine();
  const active = users.filter((u) => u.is_active).length;

  v.innerHTML = html`
  <div class="page-head"><h1>ผู้ใช้</h1>
    <button class="btn btn-primary" data-act="create">${svg(ICON.plus, 18)}สร้างบัญชี</button>
    <div class="page-meta"><span>${isOwner() ? (ownerLine() ? lineName(ownerLine()) : "ทุกสาย") : lineName(state.me.line_id)}</span>
      <span>ใช้งาน ${active} จาก ${users.length} บัญชี</span></div>
  </div>
  ${users.length ? html`<div class="ledger table-wrap"><table class="rtable">
    <thead><tr><th>ชื่อ</th><th>Username</th><th>บทบาท</th>${showLine ? html`<th>สาย</th>` : ""}<th>สถานะ</th><th></th></tr></thead>
    <tbody>${users.map((u) => html`<tr class="${u.is_active ? "" : "off"}">
      <td class="cell-title"><b>${u.display_name}</b>${u.id === state.me.id ? " (คุณ)" : ""}</td>
      <td class="num" data-label="Username">${u.username}</td>
      <td data-label="บทบาท">${ROLE_TH[u.role]}</td>
      ${showLine ? html`<td data-label="สาย">${lineName(u.line_id)}</td>` : ""}
      <td data-label="สถานะ"><span class="pill-state ${u.is_active ? "on" : "off"}">${u.is_active ? "ใช้งาน" : "ระงับ"}</span></td>
      <td class="r cell-actions" style="white-space:nowrap">${canManage(u) ? html`
        <button class="btn btn-sm btn-quiet" data-act="reset" data-id="${u.id}">รีเซ็ตรหัสผ่าน</button>
        <button class="btn btn-sm ${u.is_active ? "btn-quiet btn-danger" : ""}" data-act="toggle" data-id="${u.id}">${u.is_active ? "ระงับ" : "เปิดใช้"}</button>` : ""}</td>
    </tr>`)}</tbody></table></div>` : emptyBox("ยังไม่มีผู้ใช้ในสายนี้", "กดสร้างบัญชีเพื่อเพิ่มคนแรก")}`.s;

  v.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const u = users.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "create") createUserModal();
    if (b.dataset.act === "reset") resetPasswordModal(u);
    if (b.dataset.act === "toggle") {
      const on = !u.is_active;
      confirmBox(on ? "เปิดใช้บัญชีนี้?" : "ระงับบัญชีนี้?",
        on ? `${u.display_name} จะเข้าระบบได้อีกครั้ง` : `${u.display_name} จะเข้าระบบไม่ได้ทันที ลูกค้าที่เคยเพิ่มยังอยู่ในสายตามเดิม`,
        on ? "เปิดใช้บัญชี" : "ระงับบัญชี", async () => {
          try { await manageUser({ action: "set_active", user_id: u.id, active: on }); }
          catch (err) { toast(err.message, true); return false; }
          toast(on ? "เปิดใช้บัญชีแล้ว" : "ระงับบัญชีแล้ว"); route(); return true;
        }, !on);
    }
  };
}

export function credentialsModal(title, username, password) {
  openModal({
    title,
    body: html`<p style="margin:0 0 12px;color:var(--ink-2)">ส่งข้อมูลนี้ให้ผู้ใช้ รหัสผ่านจะไม่แสดงอีก</p>
      <div class="cred"><div class="k">Username</div><div class="v">${username}</div>
        <div class="k">รหัสผ่าน</div><div class="v">${password}</div></div>`,
    foot: html`<button type="button" class="btn" data-act="copy">คัดลอก</button>
      <button type="button" class="btn btn-primary" data-close>เสร็จแล้ว</button>`,
    onMount: (form) => {
      form.querySelector("[data-act=copy]").onclick = async () => {
        try { await navigator.clipboard.writeText(`Username: ${username}\nรหัสผ่าน: ${password}`); toast("คัดลอกแล้ว"); }
        catch { toast("คัดลอกไม่ได้ จดข้อมูลจากหน้าจอแทน", true); }
      };
    },
  });
}

export const passwordField = () => html`<div class="field"><label for="f-pw">รหัสผ่าน</label>
  <div style="display:flex;gap:8px"><input id="f-pw" class="input-num" type="text" name="password" value="${genPassword()}" required>
  <button type="button" class="btn" data-act="gen">สุ่มใหม่</button></div>
  <span class="hint">อย่างน้อย 8 ตัวอักษร</span></div>`;

export function createUserModal() {
  const roles = isOwner() ? ["supervisor", "admin", "member"] : ["admin", "member"];
  openModal({
    title: "สร้างบัญชีผู้ใช้",
    body: html`<div id="msg"></div>
      ${isOwner() ? html`<div class="field"><label for="f-uline">สาย</label><select id="f-uline" name="line_id" required>
        <option value="">เลือกสาย</option>${lineOptions(state.lineFilter)}</select></div>` : ""}
      <div class="field"><label for="f-role">บทบาท</label><select id="f-role" name="role">${roles.map((r) =>
        html`<option value="${r}" ${r === "member" ? raw("selected") : ""}>${ROLE_TH[r]}</option>`)}</select></div>
      <div class="field"><label for="f-dn">ชื่อที่แสดง</label><input id="f-dn" type="text" name="display_name" required maxlength="60"></div>
      <div class="field"><label for="f-un">Username</label>
        <input id="f-un" type="text" name="username" autocapitalize="none" spellcheck="false" required>
        <span class="hint">ใช้ได้เฉพาะ a-z 0-9 _ . ยาว 3–30 ตัว</span></div>
      ${passwordField()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">สร้างบัญชี</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.querySelector("[data-act=gen]").onclick = () => { form.password.value = genPassword(); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = {
          action: "create_user",
          line_id: isOwner() ? form.line_id.value : state.me.line_id,
          role: form.role.value,
          display_name: form.display_name.value.trim(),
          username: form.username.value.trim().toLowerCase(),
          password: form.password.value,
        };
        if (!body.line_id) return (msg.innerHTML = alertBox("danger", "เลือกสายก่อน"));
        busy(form.querySelector("[type=submit]"), async () => {
          try { await manageUser(body); }
          catch (err) { msg.innerHTML = alertBox("danger", err.message); return; }
          close(); route();
          credentialsModal("สร้างบัญชีแล้ว", body.username, body.password);
        });
      };
    },
  });
}

export function resetPasswordModal(u) {
  openModal({
    title: "รีเซ็ตรหัสผ่าน " + u.display_name,
    body: html`<div id="msg"></div>${passwordField()}`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button><button type="submit" class="btn btn-primary">ตั้งรหัสผ่านใหม่</button>`,
    onMount: (form, close) => {
      form.querySelector("[data-act=gen]").onclick = () => { form.password.value = genPassword(); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const password = form.password.value;
        busy(form.querySelector("[type=submit]"), async () => {
          try { await manageUser({ action: "reset_password", user_id: u.id, password }); }
          catch (err) { form.querySelector("#msg").innerHTML = alertBox("danger", err.message); return; }
          close();
          credentialsModal("ตั้งรหัสผ่านใหม่แล้ว", u.username, password);
        });
      };
    },
  });
}
