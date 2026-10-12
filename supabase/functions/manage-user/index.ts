// Edge Function: manage-user
// จัดการบัญชีผู้ใช้ (สร้าง / ระงับ-เปิดใช้ / รีเซ็ตรหัสผ่าน) ตามลำดับชั้น
//   เจ้าของเว็บ : จัดการผู้ดูแล แอดมิน สมาชิก ได้ทุกสาย (ผู้ดูแลไม่เกิน 2 คนต่อสาย)
//   ผู้ดูแล     : จัดการแอดมินและสมาชิกในสายตัวเองเท่านั้น
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_DOMAIN = "app.local";
const MAX_SUPERVISORS_PER_LINE = 2;

type Role = "owner" | "supervisor" | "admin" | "member";
type Profile = { id: string; role: Role; line_id: string | null; is_active: boolean };
// deno-lint-ignore no-explicit-any
type Admin = any;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getProfile(admin: Admin, id: string): Promise<Profile | null> {
  const { data } = await admin.from("profiles")
    .select("id, role, line_id, is_active").eq("id", id).maybeSingle();
  return data as Profile | null;
}

// ผู้เรียกจัดการบัญชีบทบาท/สายนี้ได้ไหม
function assertCanManage(caller: Profile, role: Role, lineId: string | null) {
  if (caller.role === "owner") {
    if (role === "owner") throw new HttpError(403, "ไม่สามารถจัดการบัญชีเจ้าของเว็บได้");
    if (!lineId) throw new HttpError(400, "กรุณาเลือกสาย");
    return;
  }
  if (caller.role === "supervisor") {
    if (role !== "admin" && role !== "member") throw new HttpError(403, "ผู้ดูแลจัดการได้เฉพาะแอดมินและสมาชิก");
    if (lineId !== caller.line_id) throw new HttpError(403, "จัดการได้เฉพาะคนในสายตัวเอง");
    return;
  }
  throw new HttpError(403, "ไม่มีสิทธิ์จัดการผู้ใช้");
}

async function assertSupervisorSlot(admin: Admin, lineId: string) {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
    .eq("line_id", lineId).eq("role", "supervisor").eq("is_active", true);
  if ((count ?? 0) >= MAX_SUPERVISORS_PER_LINE) {
    throw new HttpError(400, `สายนี้มีผู้ดูแลครบ ${MAX_SUPERVISORS_PER_LINE} คนแล้ว`);
  }
}

function checkPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
  return pw;
}

async function loadTarget(admin: Admin, userId: unknown): Promise<Profile> {
  if (typeof userId !== "string") throw new HttpError(400, "ไม่พบผู้ใช้");
  const target = await getProfile(admin, userId);
  if (!target) throw new HttpError(404, "ไม่พบผู้ใช้");
  return target;
}

async function createUser(admin: Admin, caller: Profile, body: Record<string, unknown>) {
  const username = String(body.username ?? "").trim().toLowerCase();
  const displayName = String(body.display_name ?? "").trim();
  const role = body.role as Role;
  const lineId = caller.role === "supervisor" ? caller.line_id : (body.line_id as string | null);

  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    throw new HttpError(400, "username ใช้ได้เฉพาะ a-z 0-9 _ . ยาว 3–30 ตัว");
  }
  if (!displayName) throw new HttpError(400, "กรุณาใส่ชื่อที่แสดง");
  if (!["supervisor", "admin", "member"].includes(role)) throw new HttpError(400, "บทบาทไม่ถูกต้อง");
  const password = checkPassword(body.password);
  assertCanManage(caller, role, lineId);
  if (role === "supervisor") await assertSupervisorSlot(admin, lineId!);

  const { data: exists } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (exists) throw new HttpError(400, "username นี้ถูกใช้แล้ว");

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  if (error || !created?.user) throw new HttpError(400, error?.message ?? "สร้างบัญชีไม่สำเร็จ");

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id, username, display_name: displayName, role, line_id: lineId, created_by: caller.id,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new HttpError(400, "บันทึกโปรไฟล์ไม่สำเร็จ: " + pErr.message);
  }
  return { id: created.user.id };
}

async function setActive(admin: Admin, caller: Profile, body: Record<string, unknown>) {
  const target = await loadTarget(admin, body.user_id);
  if (target.id === caller.id) throw new HttpError(400, "ระงับบัญชีตัวเองไม่ได้");
  assertCanManage(caller, target.role, target.line_id);
  const active = body.active === true;
  if (active && !target.is_active && target.role === "supervisor") await assertSupervisorSlot(admin, target.line_id!);

  const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: active ? "none" : "876000h" });
  if (error) throw new HttpError(400, error.message);
  const { error: pErr } = await admin.from("profiles").update({ is_active: active }).eq("id", target.id);
  if (pErr) throw new HttpError(400, pErr.message);
  return { ok: true };
}

async function resetPassword(admin: Admin, caller: Profile, body: Record<string, unknown>) {
  const target = await loadTarget(admin, body.user_id);
  assertCanManage(caller, target.role, target.line_id);
  const password = checkPassword(body.password);
  const { error } = await admin.auth.admin.updateUserById(target.id, { password });
  if (error) throw new HttpError(400, error.message);
  return { ok: true };
}

// CORS: ตอบ preflight เอง และแนบ header ให้ทุก response (รวมตอน error)
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Secret key แบบใหม่ (SUPABASE_SECRET_KEYS) ถ้าไม่มีใช้ service_role แบบเดิม
function adminKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* ใช้ค่าแบบเดิม */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const key = adminKey();
    if (!key) throw new HttpError(500, "ไม่พบ secret key ของโปรเจกต์");
    // admin client ข้าม RLS ใช้เฉพาะหลังเช็คสิทธิ์ผู้เรียกแล้ว
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ตรวจว่าผู้เรียกล็อกอินจริง (ถาม Supabase Auth โดยตรง)
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "กรุณาเข้าสู่ระบบ");
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) throw new HttpError(401, "กรุณาเข้าสู่ระบบใหม่");
    const caller = await getProfile(admin, u.user.id);
    if (!caller || !caller.is_active) throw new HttpError(403, "บัญชีนี้ถูกระงับ");

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "create_user": return json(await createUser(admin, caller, body));
      case "set_active": return json(await setActive(admin, caller, body));
      case "reset_password": return json(await resetPassword(admin, caller, body));
      default: throw new HttpError(400, "action ไม่ถูกต้อง");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "เกิดข้อผิดพลาด";
    return json({ error: message }, status);
  }
});
