# ระบบรายการจ่ายเงินลูกค้า

เว็บ HTML + Supabase JS SDK สำหรับบันทึกบัญชีลูกค้าและจัดการรายการจ่ายเงิน แบ่งข้อมูลตามสาย มี 4 บทบาท: เจ้าของเว็บ, ผู้ดูแล, แอดมิน, สมาชิก

```
payout-app/
├── supabase/
│   ├── schema.sql                       ตาราง + RLS + ฟังก์ชันทั้งหมด
│   └── functions/manage-user/index.ts   Edge Function สร้าง/ระงับผู้ใช้ รีเซ็ตรหัสผ่าน
└── web/
    ├── index.html
    ├── app.js
    ├── style.css
    └── config.js                        ใส่ URL และ anon key ของโปรเจกต์
```

## ติดตั้ง

### 1. สร้างโปรเจกต์ Supabase
สร้างโปรเจกต์ใหม่ที่ supabase.com (แนะนำ region Singapore)

### 2. สร้างฐานข้อมูล
Dashboard → **SQL Editor** → วางเนื้อหา `supabase/schema.sql` ทั้งไฟล์ → Run
(รันครั้งเดียวบนโปรเจกต์ใหม่ ถ้ารันซ้ำจะ error เพราะตารางมีอยู่แล้ว)

### 3. ปิดการสมัครสมาชิกเอง
Dashboard → **Authentication → Sign In / Providers**
- ปิด **Allow new users to sign up** (ผู้ใช้ทุกคนต้องถูกสร้างโดยผู้ดูแลหรือเจ้าของเว็บเท่านั้น)
- เปิด Email provider ไว้ (ระบบใช้ username แต่ Supabase ต้องการรูปแบบอีเมลเบื้องหลัง)

### 4. Deploy Edge Function
ด้วย Supabase CLI:
```bash
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy manage-user
```
หรือใน Dashboard → **Edge Functions → Deploy a new function** ตั้งชื่อ `manage-user` แล้ววางโค้ดจาก `index.ts`

ไม่ต้องตั้ง secret เพิ่ม Supabase ใส่ค่าที่ต้องใช้ให้อัตโนมัติ
ปิด **Verify JWT** ในหน้า Details ของฟังก์ชัน เพราะโค้ดตรวจการล็อกอินเองผ่าน `withSupabase({ auth: "user" })`

### 5. สร้างบัญชีเจ้าของเว็บคนแรก
Dashboard → **Authentication → Users → Add user → Create new user**
- Email: `owner@app.local` (เปลี่ยน `owner` เป็น username ที่ต้องการ ตัวพิมพ์เล็ก)
- Password: ตั้งรหัสผ่าน
- ติ๊ก **Auto Confirm User**

จากนั้นรันใน SQL Editor:
```sql
insert into public.profiles (id, username, display_name, role)
select id, 'owner', 'เจ้าของเว็บ', 'owner'
from auth.users where email = 'owner@app.local';
```

### 6. ตั้งค่าหน้าเว็บ
แก้ `web/config.js` ใส่ค่าจาก Dashboard → **Project Settings → API**
- `SUPABASE_URL` = Project URL
- `SUPABASE_ANON_KEY` = Publishable key (`sb_publishable_...`) หรือ anon key แบบเดิม

> ห้ามใส่ Secret key (`sb_secret_...`) หรือ `service_role` key ในหน้าเว็บเด็ดขาด

### 7. เปิดเว็บ
อัปโหลดโฟลเดอร์ `web/` ขึ้น static hosting ใดก็ได้ เช่น Netlify, Vercel, Cloudflare Pages, GitHub Pages
ทดสอบในเครื่อง: `cd web && python3 -m http.server 8000` แล้วเปิด http://localhost:8000
(เปิดไฟล์ตรงด้วย `file://` ไม่ได้ เพราะใช้ ES modules)

## เริ่มใช้งาน
1. เจ้าของเว็บล็อกอิน → หน้า **สาย** → สร้างสาย
2. หน้า **ผู้ใช้** → สร้างผู้ดูแลของสาย (สูงสุด 2 คนต่อสาย)
3. ผู้ดูแลล็อกอิน → สร้างแอดมินและสมาชิกในสายตัวเอง
4. สมาชิกเพิ่มลูกค้า → สร้างรายการโอน → แอดมินโอนที่ **คิวโอน** → ผู้ดูแลดู **รายงานรายวัน**

## Flow สถานะรายการ

| สถานะ | ใครทำ | ทำอะไรต่อได้ |
| --- | --- | --- |
| รอโอน | สมาชิกส่ง | สมาชิกแก้ยอด/ยกเลิกได้ · แอดมินกด "โอนแล้ว" หรือ "ยกเลิก" (ส่งกลับ) |
| โอนแล้ว | แอดมินกด | แอดมิน**คนเดิม**กด "ยืนยัน" หรือ "ย้อนกลับเป็นรอโอน" ถ้ากดผิดรายการ |
| ยืนยันแล้ว | แอดมินคนเดิม | ล็อก แก้ไม่ได้ |
| ส่งกลับแก้ไข | แอดมินยกเลิก | สมาชิกแก้แล้วส่งใหม่ (กลับเป็นรอโอน) หรือยกเลิก |
| ยกเลิก | สมาชิก | จบ |

## ความปลอดภัย (สรุป)
- ทุกตารางเปิด RLS ผู้ใช้เห็นเฉพาะสายตัวเอง เจ้าของเว็บเห็นทุกสาย บัญชีที่ถูกระงับเห็นอะไรไม่ได้ทันที
- การเปลี่ยนสถานะรายการทำผ่านฟังก์ชันในฐานข้อมูลเท่านั้น แก้ตารางตรงไม่ได้
- กด "โอนแล้ว" พร้อมกันสองคน คนที่สองจะถูกปฏิเสธ และถ้าสมาชิกเพิ่งแก้ยอด แอดมินต้องโหลดใหม่ก่อนกดได้
- รายการเก็บสำเนาชื่อ/เลขบัญชี ณ ตอนส่ง แก้บัญชีทีหลังไม่กระทบรายการเดิม
- ทุกการเพิ่ม/แก้ถูกบันทึกในตาราง `audit_logs` (ดูได้ใน Table Editor)
- ลูกค้าและบัญชีลบไม่ได้

## หมายเหตุ
- เวลาในรายงานรายวันใช้เวลาประเทศไทย (UTC+7)
- username ใช้ได้เฉพาะ a-z 0-9 _ . (3–30 ตัว) รหัสผ่านอย่างน้อย 8 ตัว
- ข้อมูลบัญชีธนาคารเป็นข้อมูลส่วนบุคคลตาม PDPA ควรจำกัดคนเข้าถึง Dashboard และเปิด Point-in-Time Recovery/Backup ของ Supabase
