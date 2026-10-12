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
