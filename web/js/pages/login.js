// หน้าเข้าสู่ระบบ
import { EMAIL_DOMAIN, sb } from "../core/config.js";
import { isOwner, session, storage } from "../core/format.js";
import { html } from "../core/html.js";
import { BRAND } from "../core/icons.js";
import { route } from "../core/router.js";
import { app, state } from "../core/state.js";
import { alertBox, busy, toast } from "../core/ui.js";

export async function loadMe() {
  const { data: { session: s } } = await sb.auth.getSession();
  if (!s) { state.me = null; return; }
  const { data: me } = await sb.from("profiles")
    .select("id,username,display_name,role,line_id,is_active").eq("id", s.user.id).maybeSingle();
  if (!me || !me.is_active) {
    await sb.auth.signOut();
    state.me = null;
    toast("บัญชีนี้ถูกระงับหรือไม่พบโปรไฟล์", true);
    return;
  }
  state.me = me;
  const [banks, lines] = await Promise.all([
    sb.from("banks").select("code,name_th").order("sort"),
    sb.from("lines").select("id,name").order("name"),
  ]);
  state.banks = banks.data || [];
  state.bankMap = Object.fromEntries(state.banks.map((b) => [b.code, b.name_th]));
  state.lines = lines.data || [];
  state.lineFilter = isOwner() ? storage("lineFilter") : "";
  if (state.lineFilter && !state.lines.some((l) => l.id === state.lineFilter)) state.lineFilter = "";
}

export function viewLogin() {
  app.innerHTML = html`<div class="login-wrap"><form class="login" id="login" novalidate>
    ${BRAND}
    <h1>ระบบรายการจ่ายเงิน</h1>
    <p>เข้าสู่ระบบด้วย username ที่ได้รับจากผู้ดูแล</p>
    <div id="login-err"></div>
    <div class="field"><label for="u">Username</label>
      <input type="text" id="u" name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
    <div class="field"><label for="p">รหัสผ่าน</label>
      <input type="password" id="p" name="p" autocomplete="current-password" required></div>
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:6px" type="submit">เข้าสู่ระบบ</button>
  </form></div>`.s;
  const form = app.querySelector("#login");
  form.u.focus();
  form.onsubmit = (e) => {
    e.preventDefault();
    const username = form.u.value.trim().toLowerCase();
    const password = form.p.value;
    const errBox = form.querySelector("#login-err");
    if (!username || !password) { errBox.innerHTML = alertBox("danger", "กรอก username และรหัสผ่านให้ครบ"); return; }
    busy(form.querySelector("[type=submit]"), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: `${username}@${EMAIL_DOMAIN}`, password });
      if (error) {
        errBox.innerHTML = alertBox("danger", /banned/i.test(error.message) ? "บัญชีนี้ถูกระงับ ติดต่อผู้ดูแลของสาย" : "username หรือรหัสผ่านไม่ถูกต้อง");
        return;
      }
      await loadMe();
      route();
    });
  };
}
