// รูปประกอบคิวโอน: อัปโหลด (ย่อรูปก่อนส่ง) แสดงเป็นแกลเลอรี ดูรูปใหญ่ และลบ
import { sb } from "./config.js";
import { clock, errMsg, isOwner, lineName, ownerLine, rank, todayBkk } from "./format.js";
import { html } from "./html.js";
import { ICON, svg } from "./icons.js";
import { state } from "./state.js";
import { confirmBox, openModal, toast } from "./ui.js";

export const BUCKET = "queue-images";
const MAX_SIDE = 1600;        // ด้านยาวสุดหลังย่อ (px)
const QUALITY = 0.82;         // คุณภาพ JPEG
const MAX_INPUT = 20 * 1024 * 1024;
const COLS = "id,line_id,path,created_at,created_by,uploader:profiles!queue_images_created_by_fkey(display_name)";

const canDelete = () => rank() >= 2; // แอดมินขึ้นไป

// ลิงก์ชั่วคราวของรูป (bucket ส่วนตัว) เก็บไว้ใช้ซ้ำ ไม่ให้รูปโหลดใหม่ทุกครั้งที่คิวรีเฟรช
const urlCache = new Map();
async function signedUrls(paths) {
  const now = Date.now();
  const need = paths.filter((p) => !(urlCache.get(p)?.exp > now + 60e3));
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    for (const d of data || []) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 3600e3 });
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url || ""]));
}

// รูปของวันนี้ (เวลาไทย) ใหม่สุดก่อน
export async function loadTodayImages({ mine = false } = {}) {
  let q = sb.from("queue_images").select(COLS).gte("created_at", `${todayBkk()}T00:00:00+07:00`)
    .order("created_at", { ascending: false }).limit(200);
  if (mine) q = q.eq("created_by", state.me.id);
  else if (ownerLine()) q = q.eq("line_id", ownerLine());
  const { data, error } = await q;
  if (error) return { images: [], error };
  const urls = await signedUrls(data.map((r) => r.path));
  return { images: data.map((r) => ({ ...r, url: urls[r.path] })), error: null };
}

// ย่อรูปให้ด้านยาวไม่เกิน 1600px แล้วแปลงเป็น JPEG (ประหยัดพื้นที่และโหลดเร็ว)
async function shrink(file) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name || "ไฟล์"} ไม่ใช่รูปภาพ`);
  if (file.size > MAX_INPUT) throw new Error(`${file.name || "รูป"} ใหญ่เกิน 20 MB`);
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`เปิดรูป ${file.name || ""} ไม่ได้ (ลองบันทึกเป็น JPG หรือ PNG ก่อน)`); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("แปลงรูปไม่สำเร็จ")), "image/jpeg", QUALITY));
}

// ชื่อไฟล์สุ่ม (ใช้ได้ทั้ง https และ http)
const uid = () => crypto.randomUUID?.() ||
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// อัปโหลดหลายรูป คืนจำนวนที่สำเร็จ และรายการที่ไม่สำเร็จ
export async function uploadImages(lineId, files, onProgress = () => {}) {
  const done = { ok: 0, failed: [] };
  let i = 0;
  for (const file of files) {
    onProgress(++i, files.length);
    try {
      const blob = await shrink(file);
      const path = `${lineId}/${todayBkk()}-${uid()}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.from("queue_images").insert({ line_id: lineId, path });
      if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
      done.ok++;
    } catch (e) {
      done.failed.push(`${file.name || "รูป"}: ${errMsg(e)}`);
    }
  }
  return done;
}

export async function deleteImage(img) {
  // ลบไฟล์ก่อน แล้วค่อยลบรายการ (ถ้าลบไฟล์ไม่ได้ รายการยังอยู่ให้ลองใหม่ได้)
  const rm = await sb.storage.from(BUCKET).remove([img.path]);
  if (rm.error) return rm.error;
  const { error } = await sb.from("queue_images").delete().eq("id", img.id);
  if (!error) urlCache.delete(img.path);
  return error;
}

// แกลเลอรีรูป: data-img-open / data-img-del ให้หน้าที่ใช้จัดการคลิก
export function gallery(images, { showUploader = true, emptyText = "ยังไม่มีรูปวันนี้" } = {}) {
  if (!images.length) return html`<div class="img-empty">${emptyText}</div>`;
  const showLine = isOwner() && !ownerLine();
  return html`<div class="img-grid">${images.map((im) => html`
    <figure class="img-tile">
      <button type="button" class="img-thumb" data-img-open="${im.id}" aria-label="ดูรูปขนาดใหญ่">
        <img src="${im.url}" alt="รูปประกอบคิวโอน" loading="lazy" decoding="async"></button>
      <figcaption>${clock(im.created_at)}${showUploader && im.uploader?.display_name ? ` ${im.uploader.display_name}` : ""}${showLine ? ` ${lineName(im.line_id)}` : ""}</figcaption>
      ${canDelete() ? html`<button type="button" class="img-del" data-img-del="${im.id}" aria-label="ลบรูป">×</button>` : ""}
    </figure>`)}</div>`;
}

// ดูรูปใหญ่ (มีปุ่มลบสำหรับแอดมินขึ้นไป)
export function openImage(img, afterDelete) {
  openModal({
    title: `รูปเวลา ${clock(img.created_at)}${img.uploader?.display_name ? ` จาก ${img.uploader.display_name}` : ""}`,
    wide: true,
    body: html`<div class="img-view"><img src="${img.url}" alt="รูปประกอบคิวโอน"></div>`,
    foot: html`${canDelete() ? html`<button type="button" class="btn btn-quiet btn-danger" data-act="del">ลบรูป</button>` : ""}
      <a class="btn" href="${img.url}" target="_blank" rel="noopener">เปิดในแท็บใหม่</a>
      <button type="button" class="btn btn-primary" data-close>ปิด</button>`,
    onMount: (form, close) => {
      form.querySelector("[data-act=del]")?.addEventListener("click", () => {
        close();
        askDelete(img, afterDelete);
      });
    },
  });
}

export function askDelete(img, afterDelete) {
  confirmBox("ลบรูปนี้?", "รูปจะถูกลบถาวร ทุกคนในสายจะไม่เห็นรูปนี้อีก", "ลบรูป", async () => {
    const err = await deleteImage(img);
    if (err) { toast(errMsg(err), true); return false; }
    toast("ลบรูปแล้ว");
    afterDelete?.();
    return true;
  }, true);
}

// ช่องอัปโหลด: ปุ่มเลือกรูป (หลายรูป) + วางรูปจากคลิปบอร์ด (Ctrl+V)
export function uploaderBox() {
  const pickLine = isOwner();
  return html`<div class="img-upload">
    ${pickLine ? html`<select id="img-line" aria-label="สายที่จะส่งรูป"><option value="">เลือกสาย</option>${state.lines.map((l) =>
      html`<option value="${l.id}" ${l.id === state.lineFilter ? "selected" : ""}>${l.name}</option>`)}</select>` : ""}
    <label class="btn btn-primary img-add">${svg(ICON.camera, 18)}<span class="lbl">เพิ่มรูป</span>
      <input type="file" id="img-file" accept="image/*" multiple hidden></label>
    <span class="hint img-hint">เลือกได้หลายรูป หรือกด Ctrl+V วางรูปที่คัดลอกไว้</span>
  </div>`;
}

// ผูกการทำงานของช่องอัปโหลด คืนฟังก์ชันสำหรับเลิกฟังการวางรูป (เรียกตอนออกจากหน้า)
export function bindUploader(root, onDone) {
  const input = root.querySelector("#img-file");
  if (!input) return () => {};
  const lineOf = () => isOwner() ? root.querySelector("#img-line")?.value : state.me.line_id;
  let working = false;
  const send = async (files) => {
    files = files.filter((f) => /^image\//.test(f.type));
    if (!files.length || working) return;
    const lineId = lineOf();
    if (!lineId) { toast("เลือกสายก่อนเพิ่มรูป", true); return; }
    working = true;
    const label = input.closest("label");
    label.classList.add("is-busy");
    const lbl = label.querySelector(".lbl");
    const done = await uploadImages(lineId, files, (n, all) => { lbl.textContent = `กำลังส่ง ${n}/${all}`; });
    lbl.textContent = "เพิ่มรูป";
    label.classList.remove("is-busy");
    working = false;
    input.value = "";
    if (done.ok) toast(`ส่งรูปแล้ว ${done.ok} รูป`);
    if (done.failed.length) toast(`ส่งไม่สำเร็จ ${done.failed.length} รูป: ${done.failed[0]}`, true);
    onDone?.();
  };
  input.onchange = () => send([...input.files]);
  const onPaste = (e) => {
    if (document.getElementById("modal-root")?.children.length) return; // กำลังเปิดหน้าต่างอื่นอยู่
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => /^image\//.test(f.type))) { e.preventDefault(); send(files); }
  };
  window.addEventListener("paste", onPaste);
  return () => window.removeEventListener("paste", onPaste);
}

// จัดการคลิกในแกลเลอรี
export function handleGalleryClick(e, images, refresh) {
  const del = e.target.closest("[data-img-del]");
  if (del) { askDelete(images.find((x) => x.id === del.dataset.imgDel), refresh); return true; }
  const open = e.target.closest("[data-img-open]");
  if (open) { openImage(images.find((x) => x.id === open.dataset.imgOpen), refresh); return true; }
  return false;
}
