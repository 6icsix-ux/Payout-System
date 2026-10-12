-- รันครั้งเดียวใน SQL Editor (สำหรับโปรเจกต์ที่รัน schema.sql ไปแล้ว)
-- ห้ามมีชื่อไลน์ลูกค้าซ้ำในสายเดียวกัน
create unique index if not exists customers_unique_name_in_line
  on public.customers (line_id, lower(btrim(line_name)));
