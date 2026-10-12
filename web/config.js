// ใส่ค่าจาก Supabase Dashboard > Project Settings > API
// anon key อยู่ในหน้าเว็บได้ เพราะสิทธิ์ทั้งหมดคุมด้วย RLS ในฐานข้อมูล
// ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด
export const SUPABASE_URL = "https://wxtzaamigmhspljttpzd.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_DOe0bVUWdJ6GTnGklbxuFQ_E5a-ZesW";

// ต้องตรงกับ EMAIL_DOMAIN ใน supabase/functions/manage-user/index.ts
export const EMAIL_DOMAIN = "app.local";

// ชื่อ Edge Function ที่ deploy ใน Supabase (slug ในลิงก์ /functions/v1/...)
export const FUNCTION_NAME = "dynamic-function";
