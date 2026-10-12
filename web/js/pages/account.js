// เปลี่ยนรหัสผ่านของตัวเอง
import { EMAIL_DOMAIN, sb } from "../core/config.js";
import { html } from "../core/html.js";
import { state } from "../core/state.js";
import { alertBox, busy, openModal, toast } from "../core/ui.js";

// เปลี่ยนรหัสผ่านของตัวเอง (ทุกบทบาท) ต้องยืนยันรหัสผ่านเดิมก่อน
export function changeOwnPasswordModal() {
  openModal({
    title: "เปลี่ยนรหัสผ่านของฉัน",
    body: html`<div id="msg"></div>
      <div class="field"><label for="pw-cur">รหัสผ่านปัจจุบัน</label>
        <input id="pw-cur" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">รหัสผ่านใหม่</label>
        <input id="pw-new" type="password" name="next" autocomplete="new-password" required>
        <span class="hint">อย่างน้อย 8 ตัวอักษร</span></div>
      <div class="field"><label for="pw-again">ยืนยันรหัสผ่านใหม่</label>
        <input id="pw-again" type="password" name="again" autocomplete="new-password" required></div>
      <label class="check-line show-pw"><input type="checkbox" name="show"><span>แสดงรหัสผ่านที่พิมพ์</span></label>`,
    foot: html`<button type="button" class="btn btn-quiet" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary">เปลี่ยนรหัสผ่าน</button>`,
    onMount: (form, close) => {
      const msg = form.querySelector("#msg");
      form.show.onchange = () => {
        for (const n of ["current", "next", "again"]) form[n].type = form.show.checked ? "text" : "password";
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const cur = form.current.value, next = form.next.value, again = form.again.value;
        if (!cur) return (msg.innerHTML = alertBox("danger", "กรอกรหัสผ่านปัจจุบัน"));
        if (next.length < 8) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร"));
        if (next !== again) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"));
        if (next === cur) return (msg.innerHTML = alertBox("danger", "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"));
        busy(form.querySelector("[type=submit]"), async () => {
          // ยืนยันว่าเป็นเจ้าของบัญชีจริง ด้วยการเข้าสู่ระบบด้วยรหัสผ่านเดิม
          const { error: authErr } = await sb.auth.signInWithPassword({
            email: `${state.me.username}@${EMAIL_DOMAIN}`, password: cur,
          });
          if (authErr) { msg.innerHTML = alertBox("danger", "รหัสผ่านปัจจุบันไม่ถูกต้อง"); return; }
          const { error } = await sb.auth.updateUser({ password: next });
          if (error) {
            const m = /different from the old|same/i.test(error.message) ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"
              : /weak|least/i.test(error.message) ? "รหัสผ่านใหม่ง่ายเกินไป ลองใช้ตัวอักษรผสมตัวเลข" : error.message;
            msg.innerHTML = alertBox("danger", m);
            return;
          }
          close();
          toast("เปลี่ยนรหัสผ่านแล้ว ใช้รหัสใหม่ในการเข้าสู่ระบบครั้งถัดไป");
        });
      };
    },
  });
}
