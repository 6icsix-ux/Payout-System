// ตัวช่วยสร้าง HTML (escape ทุกค่าอัตโนมัติ กัน XSS)

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }

export const raw = (s) => new Raw(s);

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("")
  : v === false || v == null ? "" : esc(v);

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}
