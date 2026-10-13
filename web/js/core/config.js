// ค่าตั้งต้น: การเชื่อมต่อ Supabase และค่าคงที่ที่ใช้ทั้งระบบ
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as cfg from "../../config.js";

export const { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } = cfg;

// ชื่อ Edge Function (ถ้า slug ไม่ใช่ manage-user ให้ใส่ FUNCTION_NAME ใน config.js)
export const FUNCTION_NAME = cfg.FUNCTION_NAME || "manage-user";

export const ROLE_TH = { owner: "เจ้าของเว็บ", supervisor: "ผู้ดูแล", admin: "แอดมิน", member: "สมาชิก" };

export const RANK = { member: 1, admin: 2, supervisor: 3, owner: 4 };

export const STATUS_TH = {
  pending: "รอโอน", transferred: "โอนแล้ว", confirmed: "ยืนยันแล้ว",
  returned: "ส่งกลับแก้ไข", cancelled: "ยกเลิก",
};

export const PCOLS =
  "id,line_id,customer_id,bank_account_id,account_name,account_number,bank_code,customer_line_name," +
  "amount,note,status,version,return_reason,created_by,created_at,transferred_by,transferred_at," +
  "confirmed_at,returned_at,returned_by,batch_id," +
  "creator:profiles!payout_requests_created_by_fkey(display_name)," +
  "transferrer:profiles!payout_requests_transferred_by_fkey(display_name)";

export const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-");

export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
