// =====================================================================
// แยกข้อความลูกค้าที่ก๊อปมาจากไลน์ (หลายรายในครั้งเดียว)
// ผลลัพธ์ต้องให้คนตรวจทานก่อนบันทึกเสมอ
// =====================================================================

// คำที่ลูกค้าใช้เรียกธนาคาร (เทียบหลังตัดช่องว่าง จุด ขีด และทำเป็นตัวเล็ก)
const BANK_ALIASES = [
  ["BAY", ["กรุงศรีอยุธยา", "กรุงศรี", "krungsri", "bay", "kma"]],
  ["KBANK", ["กสิกรไทย", "กสิกร", "กสิ", "kbank", "kplus", "เคแบงก์", "เคแบงค์"]],
  ["SCB", ["ไทยพาณิชย์", "ไทยพาณิช", "ไทยพานิชย์", "ไทยพานิช", "ไทยพาน", "scb"]],
  ["BBL", ["กรุงเทพ", "บัวหลวง", "bbl", "bualuang"]],
  ["KTB", ["กรุงไทย", "ktb"]],
  ["TTB", ["ทหารไทยธนชาต", "ทหารไทย", "ธนชาต", "ทีทีบี", "ttb", "tmb"]],
  ["GSB", ["ออมสิน", "gsb", "mymo"]],
  ["BAAC", ["ธกส", "เพื่อการเกษตร", "baac"]],
  ["GHB", ["อาคารสงเคราะห์", "ธอส", "ghb"]],
  ["UOB", ["ยูโอบี", "uob"]],
  ["CIMB", ["ซีไอเอ็มบี", "cimb"]],
  ["KKP", ["เกียรตินาคินภัทร", "เกียรตินาคิน", "kkp"]],
  ["LHB", ["แลนด์แอนด์เฮ้าส์", "แลนด์แอนด์เฮาส์", "lhbank", "lhb"]],
  ["TISCO", ["ทิสโก้", "tisco"]],
  ["ICBC", ["ไอซีบีซี", "icbc"]],
  ["IBANK", ["อิสลามแห่งประเทศไทย", "อิสลาม", "ibank"]],
  ["PROMPTPAY", ["พร้อมเพย์", "พร้อมเพ", "promptpay"]],
];
const ALIAS_LIST = BANK_ALIASES
  .flatMap(([code, words]) => words.map((w) => [w, code]))
  .sort((a, b) => b[0].length - a[0].length); // คำยาวก่อน กัน "กรุงศรี" ไปชน "กรุง..."

// คำที่ไม่ใช่ข้อมูล ตัดทิ้ง
const FILLER = /(ค่ะ|คะ|ครับ|คับ|จ้า|จ้ะ|นะคะ|นะครับ|นะ|ธนาคาร|ธ\.|บัญชี|บช\.?|เลขที่|เลข|โอนเข้า|โอน|ให้)/g;
const CHANGE_NOTE = /\s*(เปลี่ยน\s*(บช|บัญชี)\.?|บัญชีใหม่|บชใหม่|เปลี่ยนเลข(บัญชี)?)\s*/g;
const FILLER_TAIL = /\s*(ค่ะ|คะ|ครับ|คับ|จ้า|นะคะ|นะครับ)\s*$/;
const NAME_PREFIX = /^(นางสาว|นาง|นาย|น\.ส\.?|นส\.?|ด\.ช\.?|ด\.ญ\.?|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|ms\.?|miss)\s*/i;
const NAME_LABEL = /^(ชื่อบัญชี|ชื่อ)\s*[:：-]?\s*/;
const DIGIT_RUN = /\d[\d\s-]{4,}\d/g;

const squash = (s) => s.toLowerCase().replace(/[\s.\-_,()]/g, "");

export function findBank(text) {
  const thai = squash(text);
  const latin = text.toLowerCase().replace(/[.\-_]/g, ""); // k-bank -> kbank, ธ.ก.ส. -> ธกส
  for (const [alias, code] of ALIAS_LIST) {
    if (/[a-z]/.test(alias)) {
      // คำอังกฤษต้องเป็นคำทั้งคำ กัน "bay" ไปเจอในชื่อ Baylor
      if (new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(latin)) return code;
    } else if (thai.includes(squash(alias))) return code;
  }
  return null;
}

// มีตัวอักษรไทยหรืออังกฤษจริงไหม (ไม่ใช่แค่อีโมจิ/เครื่องหมาย)
const hasLetters = (s) => /[A-Za-zก-ฮ]/.test(s);

function cleanLineName(raw) {
  return raw.replace(/^[@＠]+/, "").replace(CHANGE_NOTE, " ").replace(/\s+/g, " ").trim();
}

function cleanPersonName(raw) {
  return raw.replace(NAME_LABEL, "").replace(/\s+/g, " ").replace(/[.。]+$/, "").trim();
}

// แบ่งข้อความเป็นก้อน ก้อนละ 1 ลูกค้า
export function splitBlocks(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const blocks = [];
  let cur = [], curHasNumber = false;
  const flush = () => { if (cur.length) blocks.push(cur); cur = []; curHasNumber = false; };
  for (const line of lines) {
    if (!line) { flush(); continue; }
    // เจอ @ ใหม่หลังจากก้อนนี้มีเลขบัญชีแล้ว = ลูกค้าคนใหม่ (กรณีไม่เว้นบรรทัด)
    if (/^[@＠]/.test(line) && curHasNumber) flush();
    cur.push(line);
    if ((line.match(DIGIT_RUN) || []).some((d) => d.replace(/\D/g, "").length >= 6)) curHasNumber = true;
  }
  flush();
  return blocks;
}

// อ่าน 1 ก้อน → { line_name, bank_code, account_number, account_name, notes[] }
export function parseBlock(lines) {
  const out = { line_name: "", bank_code: "", account_number: "", account_name: "", notes: [], raw: lines.join("\n") };
  const numbers = [];
  const leftovers = [];

  for (const line of lines) {
    if (/^[@＠]/.test(line)) {
      if (!out.line_name) out.line_name = cleanLineName(line);
      continue;
    }
    let rest = line;
    for (const m of line.match(DIGIT_RUN) || []) {
      const d = m.replace(/\D/g, "");
      if (d.length >= 6) { numbers.push(d); rest = rest.replace(m, " "); }
    }
    // ชื่อบัญชี: มีคำว่า "ชื่อ" หรือคำนำหน้า (อาจอยู่บรรทัดเดียวกับธนาคาร/เลขบัญชี)
    const r = rest.trim();
    const labelAt = r.search(/ชื่อ(บัญชี)?\s*[:：-]?/);
    const titleAt = r.search(/(นางสาว|นาง|นาย|น\.ส\.?|ด\.ช\.?|ด\.ญ\.?|เด็กชาย|เด็กหญิง)(?=\S)|\b(mr|mrs|ms|miss)\.?\s/i);
    const at = labelAt >= 0 ? labelAt : titleAt;

    // หาธนาคารเฉพาะข้อความก่อนชื่อคน กันชื่อคนไปตรงกับชื่อธนาคาร
    const bank = findBank(at >= 0 ? r.slice(0, at) : r);
    if (bank && !out.bank_code) out.bank_code = bank;
    if (at >= 0 && !out.account_name) {
      const name = cleanPersonName(r.slice(at).replace(FILLER_TAIL, ""));
      if (hasLetters(name)) { out.account_name = name; continue; }
    }
    if (bank) continue; // บรรทัดนี้คือธนาคาร
    const left = rest.replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (left && hasLetters(left) && !/\d/.test(left)) leftovers.push(left);
  }

  if (numbers.length) {
    // เลือกเลขที่ยาว 10–15 หลักก่อน (เลขบัญชีปกติ) ถ้าไม่มีใช้ตัวแรก
    out.account_number = numbers.find((n) => n.length >= 10 && n.length <= 15) || numbers[0];
    if (new Set(numbers).size > 1) out.notes.push("พบตัวเลขมากกว่า 1 ชุด ตรวจเลขบัญชีอีกครั้ง");
  }
  // ไม่มีบรรทัด @ แต่มีข้อความเหลือ 2 บรรทัดขึ้นไป: บรรทัดแรกน่าจะเป็นชื่อไลน์
  if (!out.line_name && leftovers.length) {
    out.line_name = cleanLineName(leftovers.shift());
    out.notes.push("ไม่พบ @ เดาชื่อไลน์จากบรรทัดแรก");
  }
  // ชื่อบัญชีที่ไม่มีคำนำหน้า: ใช้ได้เมื่อเหลือแค่บรรทัดเดียวที่เป็นข้อความ
  if (!out.account_name && leftovers.length === 1) {
    out.account_name = cleanPersonName(leftovers[0]);
    out.notes.push("เดาชื่อบัญชีจากข้อความ ตรวจอีกครั้ง");
  }
  if (out.account_name && out.account_name.length > 100) out.account_name = out.account_name.slice(0, 100);
  return out;
}

export function parseBulk(text) {
  return splitBlocks(text).map(parseBlock).filter((r) => r.line_name || r.account_number);
}

// =====================================================================
// แจ้งโอนหลายราย เช่น
//   ($):@แสงดาว🤩 (+) 190
//   ($):@สมพิศ (+) 475+475-320 = *630*
//   ($): Rungrote929292 (+)  950+2850 = *3,800*
// ชื่อไลน์อยู่ก่อน (+) ยอดเงินอยู่หลัง (+) หรือหลัง = ถ้ามี
// =====================================================================

// คีย์สำหรับเทียบชื่อ: ตัดอีโมจิ ช่องว่าง เครื่องหมาย เหลือแค่ตัวอักษรและตัวเลข
export function nameKey(name) {
  return String(name || "").normalize("NFKC").toLowerCase()
    .replace(/[︎️​-‍]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

// ระยะห่างของชื่อ (จำนวนตัวอักษรที่ต้องแก้) หยุดคำนวณเมื่อเกิน max
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ชื่อคล้ายกันไหม: ตรงกันหลังตัดอีโมจิ/ช่องว่าง, ชื่อหนึ่งอยู่ในอีกชื่อ (เช่น Tukta กับ Tuktaริน7),
// หรือต่างกันแค่ 1-2 ตัวอักษร
export function similarName(a, b) {
  // ตัดเครื่องหมายบนตัวอักษรอังกฤษ (ë → e) ให้เทียบง่ายขึ้น
  const fold = (v) => nameKey(String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
  const x = [...fold(a)], y = [...fold(b)];
  if (!x.length || !y.length) return false;
  const xs = x.join(""), ys = y.join("");
  if (xs === ys) return true;
  const short = Math.min(x.length, y.length);
  if (short >= 3 && (xs.includes(ys) || ys.includes(xs))) return true;
  const max = short >= 8 ? 2 : short >= 4 ? 1 : 0;
  return max > 0 && editDistance(x, y, max) <= max;
}

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const LETTER = /[A-Za-zก-ฮ]/;
const UNITS = /(บาท|บ\.|฿|thb|ค่ะ|คะ|ครับ|คับ|จ้า|จ้ะ)/gi;

// คำนวณ 475+475-320 หรือ 2500x2 หรือ 95×4 (คูณก่อนบวกลบ)
function evalExpr(expr) {
  const e = expr.replace(/[\s,]/g, "").replace(/[x×X]/g, "*").replace(/^[*+]+|[*+-]+$/g, "");
  if (!e || !/^-?\d+(\.\d+)?([+\-*]\d+(\.\d+)?)*$/.test(e)) return null;
  return e.split(/(?=[+-])/).reduce((sum, term) => {
    const sign = term.startsWith("-") ? -1 : 1;
    return sum + sign * term.replace(/^[+-]/, "").split("*").reduce((p, f) => p * Number(f), 1);
  }, 0);
}

// ดึงนิพจน์ตัวเลขจากต้นข้อความ ถ้ามีตัวอักษรติดกับตัวเลข (เช่น 3OO) ถือว่าอ่านไม่ได้
function takeExpr(text) {
  const t = text.replace(/^[^\d]+/, "");
  const m = t.match(/^[\d,.\s+\-*x×X]*\d/);
  if (!m) return null;
  if (LETTER.test(t.charAt(m[0].length))) return null;
  return m[0];
}

function normalizeLine(raw) {
  let s = String(raw).normalize("NFKC").replace(/[๐-๙]/g, (d) => THAI_DIGITS.indexOf(d));
  // ก๊อปจากแชทไลน์: "21:05<tab>ชื่อคนส่ง<tab>ข้อความ"
  const chat = s.match(/^\s*\d{1,2}[:.]\d{2}\t[^\t]*\t(.*)$/);
  if (chat) s = chat[1];
  s = s.replace(/\t/g, " ")
    .replace(/^\s*\d{1,2}:\d{2}\s+/, "")                // เวลานำหน้า
    .replace(/^\s*\(\s*\$\s*\)\s*[:：]?\s*/, "")          // ($):
    .replace(/^\s*\d{1,3}[.)]\s+/, "")                  // 1. หรือ 2)
    .trim();
  return s;
}

const IGNORE = (s) => !/[\p{L}\d]/u.test(s) || /^\[[^\]]*\]$/.test(s)
  || (!s.includes("@") && /^(รวม|ยอดรวม|สรุป|total|sum)/i.test(s));

export function parsePayoutLine(raw) {
  const line = normalizeLine(raw);
  if (!line || IGNORE(line)) return null;
  const out = { raw: String(raw).trim(), name: "", amount: null, notes: [] };

  let namePart, amtPart;
  const plus = line.match(/\(\s*\+\s*\)/);
  if (plus) {
    namePart = line.slice(0, plus.index);
    amtPart = line.slice(plus.index + plus[0].length);
  } else {
    // ไม่มี (+): ตัวเลขชุดท้ายบรรทัดคือยอด ต้องเว้นวรรคหรือมีเครื่องหมายคั่นจากชื่อ
    const tail = line.replace(UNITS, " ").replace(/\.-/g, "").replace(/[^\d)]*$/, "").replace(/\(\D*\)$/, "").trim();
    const m = tail.match(/^(.*?)(?:\s*[:=+]+\s*|\s+)(-?\d[\d,.]*(?:\s*[+\-*x×=]\s*\**\d[\d,.]*\**)*)$/);
    if (!m) { out.name = cleanName(line); out.notes.push("ไม่พบยอดเงิน"); return out; }
    namePart = m[1]; amtPart = m[2];
  }
  out.name = cleanName(namePart);

  let a = amtPart.replace(/\(\s*\+\s*\)/g, "+").replace(UNITS, " ").replace(/\.-/g, "");
  if (/^\s*-\s*\d/.test(a)) { out.notes.push("ยอดติดลบ"); return out; }

  const eq = a.lastIndexOf("=");
  let calc = null, stated = null;
  if (eq >= 0) {
    const left = takeExpr(a.slice(0, eq));
    calc = left ? evalExpr(left) : null;
    const right = takeExpr(a.slice(eq + 1));
    stated = right && /^[\d,.\s]+$/.test(right) ? Number(right.replace(/[\s,]/g, "")) : null;
    if (stated == null && a.slice(eq + 1).trim()) out.notes.push("อ่านยอดหลัง = ไม่ได้ ใช้ยอดที่คำนวณแทน");
    if (stated != null && calc != null && Math.abs(stated - calc) > 0.001) {
      out.notes.push(`ยอดที่เขียนไว้ ${stated} ไม่ตรงกับที่คำนวณได้ ${calc}`);
    }
  } else {
    const expr = takeExpr(a);
    calc = expr ? evalExpr(expr) : null;
  }
  if (/(^|[^\d,.])\d{1,3}\.\d{3}(?![\d,.])/.test(a)) out.notes.push("ตัวเลขมีจุดตามด้วย 3 หลัก ถ้าตั้งใจเป็นหลักพัน แก้ยอดก่อนส่ง");
  const amount = stated ?? calc;
  if (amount == null || !(amount > 0)) out.notes.push("อ่านยอดเงินไม่ได้");
  else out.amount = Math.round(amount * 100) / 100;
  return out;
}

function cleanName(part) {
  let n = part;
  const at = n.search(/[@＠]/);
  if (at >= 0) n = n.slice(at + 1);
  return n.replace(/[\s:：+=]+$/, "").replace(/\s+/g, " ").trim();
}

export function parseBulkPayout(text) {
  return String(text || "").replace(/\r/g, "").split("\n")
    .map((l) => l.trim()).filter(Boolean)
    .map(parsePayoutLine).filter((r) => r && (r.name || r.amount));
}
