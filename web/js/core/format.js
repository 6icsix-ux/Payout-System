// จัดรูปแบบตัวเลข วันที่ เลขบัญชี และตัวช่วยทั่วไป
import { RANK } from "./config.js";
import { html } from "./html.js";
import { state } from "./state.js";

export const money = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const baht = (n) => html`${money(n)}<small>บาท</small>`;

export const acctFmt = (n) => /^\d{10}$/.test(n || "") ? `${n.slice(0, 3)}-${n.slice(3, 4)}-${n.slice(4, 9)}-${n.slice(9)}` : (n || "");

export const digits = (s) => String(s || "").replace(/\D/g, "");

export const dtFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const clockFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });

export const shortDayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

export const thaiDate = (d) => shortDayFmt.format(new Date(d + "T12:00:00+07:00"));

export const dayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const when = (ts) => ts ? dtFmt.format(new Date(ts)) : "";

export const clock = (ts) => ts ? clockFmt.format(new Date(ts)) + " น." : "";

export const todayBkk = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

export const shiftDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export const bankName = (code) => state.bankMap[code] || code;

export const lineName = (id) => state.lines.find((l) => l.id === id)?.name || "";

export const isOwner = () => state.me?.role === "owner";

export const rank = () => RANK[state.me?.role] || 0;

export const ownerLine = () => (isOwner() && state.lineFilter) ? state.lineFilter : null;

export const scope = (q) => { const l = ownerLine(); return l ? q.eq("line_id", l) : q; };

export const initial = (name) => (name || "?").trim().charAt(0);

export function errMsg(e) {
  if (!e) return "เกิดข้อผิดพลาด";
  const m = e.message || "";
  if (e.code === "23505" && m.includes("customers_unique_name")) return "ชื่อไลน์นี้มีในสายแล้ว";
  if (e.code === "23505" && m.includes("lines_name")) return "ชื่อสายนี้มีแล้ว";
  if (e.code === "23505") return "เลขบัญชีนี้ (ธนาคารเดียวกัน) มีในสายแล้ว";
  if (e.code === "42501") return "ไม่มีสิทธิ์ทำรายการนี้";
  return m || String(e);
}

export function storage(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key) || "";
    localStorage.setItem(key, val);
  } catch { /* ไม่มี storage ก็ทำงานต่อได้ */ }
  return "";
}

export function session(key, val) {
  try {
    if (val === undefined) return sessionStorage.getItem(key) || "";
    sessionStorage.setItem(key, val);
  } catch { /* ignore */ }
  return "";
}

// เพิ่มลูกค้าหลายรายจากข้อความที่ก๊อปมาจากไลน์
//   ชื่อไลน์ใหม่                 -> สร้างลูกค้าใหม่
//   ชื่อไลน์เดิม + บัญชีใหม่      -> เพิ่มบัญชีให้ลูกค้าเดิม
//   ชื่อไลน์เดิม + บัญชีเดิม      -> ข้าม
//   เลขบัญชีเป็นของลูกค้าคนอื่น   -> ข้าม
export const normName = (n) => String(n || "").trim().toLowerCase();
