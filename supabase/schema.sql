-- =====================================================================
-- ระบบจัดการรายการจ่ายเงินลูกค้า : Supabase schema
-- รันไฟล์นี้ทั้งไฟล์ใน Supabase Dashboard > SQL Editor (รันซ้ำไม่ได้ ให้รันบนโปรเจกต์ใหม่)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'supervisor', 'admin', 'member');

-- pending      = รอโอน
-- transferred  = โอนแล้ว (รอแอดมินคนเดิมยืนยัน)
-- confirmed    = ยืนยันแล้ว (ล็อก)
-- returned     = ส่งกลับให้สมาชิกแก้ไข
-- cancelled    = สมาชิกยกเลิกเอง
create type public.payout_status as enum ('pending', 'transferred', 'confirmed', 'returned', 'cancelled');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.lines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) between 1 and 60),
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  display_name  text not null check (length(trim(display_name)) between 1 and 60),
  role          public.app_role not null,
  line_id       uuid references public.lines (id),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  -- เจ้าของเว็บไม่สังกัดสาย ส่วนบทบาทอื่นต้องมีสาย
  constraint profiles_line_by_role check ((role = 'owner') = (line_id is null))
);
create index on public.profiles (line_id);

create table public.banks (
  code     text primary key,
  name_th  text not null,
  sort     int not null default 100
);

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references public.lines (id),
  line_name   text not null check (length(trim(line_name)) between 1 and 100),  -- ชื่อไลน์ลูกค้า
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.customers (line_id, created_at desc);
-- ชื่อไลน์ซ้ำในสายเดียวกันไม่ได้ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ และช่องว่างหัวท้าย)
create unique index customers_unique_name_in_line on public.customers (line_id, lower(btrim(line_name)));

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers (id),
  line_id         uuid not null references public.lines (id),        -- ตั้งอัตโนมัติจากลูกค้า
  account_name    text not null check (length(trim(account_name)) between 1 and 100),
  account_number  text not null check (account_number ~ '^[0-9]{6,20}$'),
  bank_code       text not null references public.banks (code),
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- เลขบัญชี + ธนาคารเดียวกัน ซ้ำในสายเดียวกันไม่ได้
  constraint bank_accounts_unique_in_line unique (line_id, bank_code, account_number)
);
create index on public.bank_accounts (customer_id);

create table public.payout_requests (
  id               uuid primary key default gen_random_uuid(),
  line_id          uuid not null references public.lines (id),
  customer_id      uuid not null references public.customers (id),
  bank_account_id  uuid not null references public.bank_accounts (id),
  -- ข้อมูลบัญชี ณ ตอนสร้าง/แก้รายการ (แก้บัญชีทีหลังไม่กระทบรายการเดิม)
  account_name     text not null,
  account_number   text not null,
  bank_code        text not null,
  customer_line_name text not null,
  amount           numeric(14, 2) not null check (amount > 0),
  note             text,
  status           public.payout_status not null default 'pending',
  version          int not null default 1,   -- เพิ่มทุกครั้งที่แก้ ใช้กันแอดมินโอนตามข้อมูลเก่า
  return_reason    text,
  created_by       uuid not null references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  transferred_by   uuid references public.profiles (id),
  transferred_at   timestamptz,
  confirmed_by     uuid references public.profiles (id),
  confirmed_at     timestamptz,
  returned_by      uuid references public.profiles (id),
  returned_at      timestamptz,
  cancelled_at     timestamptz
);
create index on public.payout_requests (line_id, status, created_at);
create index on public.payout_requests (line_id, transferred_at);
create index on public.payout_requests (created_by, created_at desc);
create index on public.payout_requests (customer_id, created_at desc);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  actor_id      uuid,
  line_id       uuid,
  action        text not null,
  target_table  text not null,
  target_id     uuid,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index on public.audit_logs (line_id, created_at desc);

-- ---------------------------------------------------------------------
-- รายชื่อธนาคาร
-- ---------------------------------------------------------------------
insert into public.banks (code, name_th, sort) values
  ('KBANK', 'กสิกรไทย', 1),
  ('SCB', 'ไทยพาณิชย์', 2),
  ('BBL', 'กรุงเทพ', 3),
  ('KTB', 'กรุงไทย', 4),
  ('BAY', 'กรุงศรีอยุธยา', 5),
  ('TTB', 'ทหารไทยธนชาต (ttb)', 6),
  ('GSB', 'ออมสิน', 7),
  ('BAAC', 'ธ.ก.ส.', 8),
  ('GHB', 'อาคารสงเคราะห์', 9),
  ('UOB', 'ยูโอบี', 10),
  ('CIMB', 'ซีไอเอ็มบี ไทย', 11),
  ('KKP', 'เกียรตินาคินภัทร', 12),
  ('LHB', 'แลนด์ แอนด์ เฮ้าส์', 13),
  ('TISCO', 'ทิสโก้', 14),
  ('ICBC', 'ไอซีบีซี (ไทย)', 15),
  ('IBANK', 'อิสลามแห่งประเทศไทย', 16),
  ('PROMPTPAY', 'พร้อมเพย์', 50);

-- ---------------------------------------------------------------------
-- Helper functions (schema app ไม่ถูกเปิดเป็น API)
-- ---------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to authenticated;

-- บทบาทของผู้ใช้ปัจจุบัน (null ถ้าถูกระงับหรือไม่มีโปรไฟล์)
create function app.me_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create function app.me_line() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.line_id from public.profiles p where p.id = auth.uid() and p.is_active
$$;

-- เห็นข้อมูลของสายนี้ได้ไหม (เจ้าของเว็บเห็นทุกสาย)
create function app.can_see_line(p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role = 'owner' or p.line_id = p_line)
  )
$$;

-- เป็นแอดมินขึ้นไปของสายนี้ไหม
create function app.is_staff_of(p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role = 'owner' or (p.role in ('supervisor', 'admin') and p.line_id = p_line))
  )
$$;

grant execute on function app.me_role(), app.me_line(), app.can_see_line(uuid), app.is_staff_of(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create function app.customers_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.line_name := trim(new.line_name);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.id := old.id;
    new.line_id := old.line_id;          -- ย้ายสายไม่ได้
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger customers_guard before insert or update on public.customers
for each row execute function app.customers_guard();

create function app.bank_accounts_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_line uuid;
begin
  new.account_number := regexp_replace(coalesce(new.account_number, ''), '[^0-9]', '', 'g');
  new.account_name := trim(new.account_name);
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.customer_id := old.customer_id;  -- ย้ายบัญชีไปลูกค้าอื่นไม่ได้
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select c.line_id into v_line from public.customers c where c.id = new.customer_id;
  new.line_id := v_line;
  new.updated_at := now();
  return new;
end $$;

create trigger bank_accounts_guard before insert or update on public.bank_accounts
for each row execute function app.bank_accounts_guard();

-- Audit log ทุกการเพิ่ม/แก้
create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(new);
begin
  insert into public.audit_logs (actor_id, line_id, action, target_table, target_id, detail)
  values (
    auth.uid(),
    case when tg_table_name = 'lines' then (r ->> 'id')::uuid else (r ->> 'line_id')::uuid end,
    lower(tg_op),
    tg_table_name,
    (r ->> 'id')::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', r) else r end
  );
  return null;
end $$;

create trigger audit after insert or update on public.lines for each row execute function app.audit();
create trigger audit after insert or update on public.profiles for each row execute function app.audit();
create trigger audit after insert or update on public.customers for each row execute function app.audit();
create trigger audit after insert or update on public.bank_accounts for each row execute function app.audit();
create trigger audit after insert or update on public.payout_requests for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.lines enable row level security;
alter table public.profiles enable row level security;
alter table public.banks enable row level security;
alter table public.customers enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.payout_requests enable row level security;
alter table public.audit_logs enable row level security;

-- ไม่ให้ anon เข้าถึงอะไรเลย
revoke all on all tables in schema public from anon;

-- สาย: เห็นสายตัวเอง / เจ้าของเว็บจัดการได้
create policy lines_select on public.lines for select to authenticated
  using (app.can_see_line(id));
create policy lines_insert on public.lines for insert to authenticated
  with check (app.me_role() = 'owner');
create policy lines_update on public.lines for update to authenticated
  using (app.me_role() = 'owner') with check (app.me_role() = 'owner');

-- โปรไฟล์: อ่านได้อย่างเดียว เขียนผ่าน Edge Function เท่านั้น
revoke insert, update, delete on public.profiles from authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or role = 'owner' or app.can_see_line(line_id));

create policy banks_select on public.banks for select to authenticated using (true);
revoke insert, update, delete on public.banks from authenticated;

-- ลูกค้า: ทุกบทบาทในสายเพิ่ม/แก้ได้ ไม่มีการลบ
revoke delete on public.customers from authenticated;
create policy customers_select on public.customers for select to authenticated
  using (app.can_see_line(line_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.can_see_line(line_id));
create policy customers_update on public.customers for update to authenticated
  using (app.can_see_line(line_id)) with check (app.can_see_line(line_id));

revoke delete on public.bank_accounts from authenticated;
create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using (app.can_see_line(line_id));
create policy bank_accounts_insert on public.bank_accounts for insert to authenticated
  with check (app.can_see_line(line_id));
create policy bank_accounts_update on public.bank_accounts for update to authenticated
  using (app.can_see_line(line_id)) with check (app.can_see_line(line_id));

-- รายการจ่ายเงิน: อ่านได้ในสาย เขียนผ่าน RPC เท่านั้น
revoke insert, update, delete on public.payout_requests from authenticated;
create policy payout_select on public.payout_requests for select to authenticated
  using (app.can_see_line(line_id));

-- Audit log: เจ้าของเว็บเห็นทั้งหมด ผู้ดูแลเห็นสายตัวเอง
revoke insert, update, delete on public.audit_logs from authenticated;
create policy audit_select on public.audit_logs for select to authenticated
  using (app.me_role() = 'owner' or (app.me_role() = 'supervisor' and line_id = app.me_line()));

-- ---------------------------------------------------------------------
-- RPC: ค้นหาลูกค้า
-- ---------------------------------------------------------------------
create function public.search_customers(p_q text default '', p_line_id uuid default null)
returns table (id uuid, line_id uuid, line_title text, line_name text, accounts jsonb, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select trim(coalesce(p_q, '')) as t,
           regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g') as digits
  )
  select c.id, c.line_id, l.name, c.line_name,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', ba.id, 'account_name', ba.account_name,
                    'account_number', ba.account_number, 'bank_code', ba.bank_code)
                  order by ba.created_at)
           from public.bank_accounts ba where ba.customer_id = c.id
         ), '[]'::jsonb),
         c.created_at
  from public.customers c
  join public.lines l on l.id = c.line_id
  cross join q
  where (p_line_id is null or c.line_id = p_line_id)
    and (
      q.t = ''
      or c.line_name ilike '%' || q.t || '%'
      or exists (
        select 1 from public.bank_accounts ba
        where ba.customer_id = c.id
          and (ba.account_name ilike '%' || q.t || '%'
               or (q.digits <> '' and ba.account_number like '%' || q.digits || '%'))
      )
    )
  order by c.created_at desc
  limit 100
$$;

-- ---------------------------------------------------------------------
-- RPC: เพิ่มลูกค้าพร้อมบัญชีแรกในครั้งเดียว (ใช้สิทธิ์ของผู้เรียก ผ่าน RLS ตามปกติ)
-- ---------------------------------------------------------------------
create function public.create_customer(
  p_line_id uuid, p_line_name text, p_account_name text, p_account_number text, p_bank_code text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.customers (line_id, line_name) values (p_line_id, p_line_name)
  returning id into v_id;
  insert into public.bank_accounts (customer_id, account_name, account_number, bank_code)
  values (v_id, p_account_name, p_account_number, p_bank_code);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RPC: รายการจ่ายเงิน (ทุกการเปลี่ยนสถานะผ่านฟังก์ชันเหล่านี้เท่านั้น)
-- ---------------------------------------------------------------------

-- สร้างรายการ (ทุกบทบาท)
create function public.create_payout(p_bank_account_id uuid, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_id uuid;
begin
  select ba.*, c.line_name as c_line_name into v
  from public.bank_accounts ba join public.customers c on c.id = ba.customer_id
  where ba.id = p_bank_account_id;

  if not found or not app.can_see_line(v.line_id) then
    raise exception 'ไม่พบบัญชีนี้' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ยอดเงินต้องมากกว่า 0' using errcode = 'P0001';
  end if;

  insert into public.payout_requests
    (line_id, customer_id, bank_account_id, account_name, account_number, bank_code,
     customer_line_name, amount, note, created_by)
  values
    (v.line_id, v.customer_id, v.id, v.account_name, v.account_number, v.bank_code,
     v.c_line_name, round(p_amount, 2), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- แก้รายการของตัวเอง (ขณะรอโอน หรือถูกส่งกลับ) ถ้าถูกส่งกลับจะกลายเป็นรอโอนอีกครั้ง
create function public.edit_payout(p_id uuid, p_bank_account_id uuid, p_amount numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.payout_requests;
  v record;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if not found or r.created_by is distinct from auth.uid() or app.me_role() is null then
    raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์แก้ไข' using errcode = 'P0001';
  end if;
  if r.status not in ('pending', 'returned') then
    raise exception 'รายการนี้ถูกดำเนินการแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ยอดเงินต้องมากกว่า 0' using errcode = 'P0001';
  end if;

  select ba.*, c.line_name as c_line_name into v
  from public.bank_accounts ba join public.customers c on c.id = ba.customer_id
  where ba.id = p_bank_account_id;
  if not found or v.line_id <> r.line_id then
    raise exception 'ไม่พบบัญชีนี้ในสาย' using errcode = 'P0001';
  end if;

  update public.payout_requests set
    customer_id = v.customer_id, bank_account_id = v.id,
    account_name = v.account_name, account_number = v.account_number, bank_code = v.bank_code,
    customer_line_name = v.c_line_name,
    amount = round(p_amount, 2), note = nullif(trim(p_note), ''),
    status = 'pending', version = version + 1, updated_at = now()
  where id = p_id;
end $$;

-- สมาชิกยกเลิกรายการของตัวเอง (ก่อนแอดมินโอน)
create function public.cancel_payout(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests
     set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now()
   where id = p_id and created_by = auth.uid() and status in ('pending', 'returned')
     and app.me_role() is not null;
  if not found then
    raise exception 'ยกเลิกไม่ได้ รายการอาจถูกโอนไปแล้ว' using errcode = 'P0001';
  end if;
end $$;

-- แอดมินกด "โอนแล้ว" (ใครกดก่อนได้ก่อน และต้องเป็นข้อมูลเวอร์ชันเดียวกับที่เห็นบนจอ)
create function public.mark_transferred(p_id uuid, p_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if not found or not app.is_staff_of(r.line_id) then
    raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'รายการนี้ถูกดำเนินการไปแล้ว กรุณาโหลดใหม่' using errcode = 'P0001';
  end if;
  if r.version <> p_version then
    raise exception 'รายการนี้เพิ่งถูกแก้ไข กรุณาตรวจยอดและบัญชีอีกครั้ง' using errcode = 'P0001';
  end if;
  update public.payout_requests set
    status = 'transferred', transferred_by = auth.uid(), transferred_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id;
end $$;

-- แอดมินคนเดิมย้อนกลับเป็น "รอโอน" (กรณีกดผิดรายการ ก่อนยืนยัน)
create function public.undo_transferred(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests set
    status = 'pending', transferred_by = null, transferred_at = null,
    version = version + 1, updated_at = now()
  where id = p_id and status = 'transferred' and transferred_by = auth.uid()
    and app.is_staff_of(line_id);
  if not found then
    raise exception 'ย้อนกลับไม่ได้ ต้องเป็นแอดมินคนที่กดโอนแล้ว และยังไม่ยืนยัน' using errcode = 'P0001';
  end if;
end $$;

-- แอดมินคนเดิมยืนยันการโอน (ล็อกรายการ)
create function public.confirm_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests set
    status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id and status = 'transferred' and transferred_by = auth.uid()
    and app.is_staff_of(line_id);
  if not found then
    raise exception 'ยืนยันไม่ได้ ต้องเป็นแอดมินคนเดียวกับที่กดโอนแล้ว' using errcode = 'P0001';
  end if;
end $$;

-- แอดมินยกเลิก = ส่งกลับให้สมาชิกแก้ไข (เฉพาะตอนรอโอน)
create function public.return_payout(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if not found or not app.is_staff_of(r.line_id) then
    raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'ยกเลิกได้เฉพาะรายการที่รอโอน' using errcode = 'P0001';
  end if;
  update public.payout_requests set
    status = 'returned', return_reason = nullif(trim(p_reason), ''),
    returned_by = auth.uid(), returned_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.search_customers(text, uuid),
  public.create_customer(uuid, text, text, text, text),
  public.create_payout(uuid, numeric, text),
  public.edit_payout(uuid, uuid, numeric, text),
  public.cancel_payout(uuid),
  public.mark_transferred(uuid, int),
  public.undo_transferred(uuid),
  public.confirm_transfer(uuid),
  public.return_payout(uuid, text)
to authenticated;
-- รันครั้งเดียวใน SQL Editor
-- 1) แอดมินยืนยันการโอนในขั้นตอนเดียว: รอโอน -> ยืนยันแล้ว
-- 2) สมาชิกดึงรายการที่ส่งไปแล้วกลับมาแก้ได้ (ก่อนแอดมินยืนยัน)

create or replace function public.confirm_payout(p_id uuid, p_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests;
begin
  select * into r from public.payout_requests where id = p_id for update;
  if not found or not app.is_staff_of(r.line_id) then
    raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'รายการนี้ถูกดำเนินการไปแล้ว กรุณาโหลดใหม่' using errcode = 'P0001';
  end if;
  if r.version <> p_version then
    raise exception 'รายการนี้เพิ่งถูกแก้ไข กรุณาตรวจยอดและบัญชีอีกครั้ง' using errcode = 'P0001';
  end if;
  update public.payout_requests set
    status = 'confirmed',
    transferred_by = auth.uid(), transferred_at = now(),
    confirmed_by = auth.uid(), confirmed_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id;
end $$;

create or replace function public.recall_payout(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payout_requests set
    status = 'returned', return_reason = 'ดึงกลับโดยผู้ส่ง',
    returned_by = auth.uid(), returned_at = now(),
    version = version + 1, updated_at = now()
  where id = p_id and created_by = auth.uid() and status = 'pending'
    and app.me_role() is not null;
  if not found then
    raise exception 'ดึงกลับไม่ได้ แอดมินอาจยืนยันการโอนไปแล้ว' using errcode = 'P0001';
  end if;
end $$;

revoke execute on function public.confirm_payout(uuid, int), public.recall_payout(uuid) from public, anon;
grant execute on function public.confirm_payout(uuid, int), public.recall_payout(uuid) to authenticated;
-- รันครั้งเดียวใน SQL Editor
-- ชื่อบัญชีธนาคารไม่บังคับ (บางครั้งลูกค้าส่งมาแค่ธนาคารกับเลขบัญชี)

alter table public.bank_accounts alter column account_name drop not null;
alter table public.bank_accounts drop constraint if exists bank_accounts_account_name_check;
alter table public.bank_accounts add constraint bank_accounts_account_name_check
  check (account_name is null or length(account_name) between 1 and 100);

alter table public.payout_requests alter column account_name drop not null;

-- ช่องว่างเปล่าให้เก็บเป็น null
create or replace function app.bank_accounts_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_line uuid;
begin
  new.account_number := regexp_replace(coalesce(new.account_number, ''), '[^0-9]', '', 'g');
  new.account_name := nullif(btrim(coalesce(new.account_name, '')), '');
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.customer_id := old.customer_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select c.line_id into v_line from public.customers c where c.id = new.customer_id;
  new.line_id := v_line;
  new.updated_at := now();
  return new;
end $$;
-- รันครั้งเดียวใน SQL Editor
-- ค้นหาลูกค้าแบบแบ่งหน้า (เลือกแสดง 30 / 60 / 90 รายการต่อหน้า) พร้อมจำนวนที่พบทั้งหมด

create or replace function public.search_customers_page(
  p_q text default '', p_line_id uuid default null, p_limit int default 30, p_offset int default 0
)
returns table (id uuid, line_id uuid, line_title text, line_name text, accounts jsonb, created_at timestamptz, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select trim(coalesce(p_q, '')) as t,
           regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g') as digits
  ),
  hits as (
    select c.id, c.line_id, c.line_name, c.created_at
    from public.customers c
    cross join q
    where (p_line_id is null or c.line_id = p_line_id)
      and (
        q.t = ''
        or c.line_name ilike '%' || q.t || '%'
        or exists (
          select 1 from public.bank_accounts ba
          where ba.customer_id = c.id
            and (ba.account_name ilike '%' || q.t || '%'
                 or (q.digits <> '' and ba.account_number like '%' || q.digits || '%'))
        )
      )
  ),
  page as (
    select h.*, count(*) over () as total_count
    from hits h
    order by h.created_at desc, h.id
    limit least(greatest(coalesce(p_limit, 30), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.line_id, l.name, p.line_name,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', ba.id, 'account_name', ba.account_name,
                    'account_number', ba.account_number, 'bank_code', ba.bank_code)
                  order by ba.created_at)
           from public.bank_accounts ba where ba.customer_id = p.id
         ), '[]'::jsonb),
         p.created_at, p.total_count
  from page p
  join public.lines l on l.id = p.line_id
  order by p.created_at desc, p.id
$$;

revoke execute on function public.search_customers_page(text, uuid, int, int) from public, anon;
grant execute on function public.search_customers_page(text, uuid, int, int) to authenticated;
-- รันครั้งเดียวใน SQL Editor
-- รูปประกอบคิวโอน: สมาชิกอัปโหลด แสดงบนหน้าคิวโอน (เฉพาะของวันนี้) ลบได้เฉพาะแอดมินขึ้นไป
-- ไฟล์อยู่ใน Storage bucket "queue-images" แบบส่วนตัว ที่ path = <line_id>/<ชื่อไฟล์>

-- ---------------------------------------------------------------------
-- Bucket (ส่วนตัว รับเฉพาะรูป ไม่เกิน 5 MB)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('queue-images', 'queue-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- ตารางรายการรูป
-- ---------------------------------------------------------------------
create table if not exists public.queue_images (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references public.lines (id),
  path        text not null unique,
  created_by  uuid not null references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists queue_images_line_created on public.queue_images (line_id, created_at desc);

alter table public.queue_images enable row level security;
revoke update on public.queue_images from authenticated;

drop policy if exists queue_images_select on public.queue_images;
create policy queue_images_select on public.queue_images for select to authenticated
  using (app.can_see_line(line_id));

drop policy if exists queue_images_insert on public.queue_images;
create policy queue_images_insert on public.queue_images for insert to authenticated
  with check (app.can_see_line(line_id) and created_by = auth.uid() and path like line_id::text || '/%');

drop policy if exists queue_images_delete on public.queue_images;
create policy queue_images_delete on public.queue_images for delete to authenticated
  using (app.is_staff_of(line_id));

-- ---------------------------------------------------------------------
-- สิทธิ์ไฟล์ใน Storage: โฟลเดอร์แรกของ path คือ line_id
-- ---------------------------------------------------------------------
create or replace function app.path_line(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function app.path_line(text) to authenticated;

drop policy if exists queue_images_read on storage.objects;
create policy queue_images_read on storage.objects for select to authenticated
  using (bucket_id = 'queue-images' and app.can_see_line(app.path_line(name)));

drop policy if exists queue_images_upload on storage.objects;
create policy queue_images_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'queue-images' and app.can_see_line(app.path_line(name)));

drop policy if exists queue_images_remove on storage.objects;
create policy queue_images_remove on storage.objects for delete to authenticated
  using (bucket_id = 'queue-images' and app.is_staff_of(app.path_line(name)));

-- บันทึกประวัติการเพิ่ม/ลบรูป
create or replace function app.audit_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (actor_id, line_id, action, target_table, target_id, detail)
  values (auth.uid(), (to_jsonb(old) ->> 'line_id')::uuid, 'delete', tg_table_name, (to_jsonb(old) ->> 'id')::uuid, to_jsonb(old));
  return null;
end $$;

drop trigger if exists audit on public.queue_images;
create trigger audit after insert on public.queue_images for each row execute function app.audit();
drop trigger if exists audit_delete on public.queue_images;
create trigger audit_delete after delete on public.queue_images for each row execute function app.audit_delete();
-- รันครั้งเดียวใน SQL Editor (ต้องรัน 006 ก่อน)
-- แนบรูปไปกับชุดรายการโอน: รายการที่ส่งพร้อมกันจาก "แจ้งโอนหลายราย" มีรหัสชุดเดียวกัน
-- รูปที่แนบผูกกับรหัสชุดนั้น แล้วแสดงเหนือรายการของชุดในหน้าคิวโอน

alter table public.payout_requests add column if not exists batch_id uuid;
create index if not exists payout_requests_batch on public.payout_requests (batch_id) where batch_id is not null;

alter table public.queue_images add column if not exists batch_id uuid;
create index if not exists queue_images_batch on public.queue_images (batch_id) where batch_id is not null;

-- create_payout รับรหัสชุดเพิ่ม (ไม่ใส่ก็ได้ ใช้กับการสร้างทีละรายการตามเดิม)
drop function if exists public.create_payout(uuid, numeric, text);
create or replace function public.create_payout(
  p_bank_account_id uuid, p_amount numeric, p_note text default null, p_batch_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_id uuid;
begin
  select ba.*, c.line_name as c_line_name into v
  from public.bank_accounts ba join public.customers c on c.id = ba.customer_id
  where ba.id = p_bank_account_id;

  if not found or not app.can_see_line(v.line_id) then
    raise exception 'ไม่พบบัญชีนี้' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ยอดเงินต้องมากกว่า 0' using errcode = 'P0001';
  end if;

  insert into public.payout_requests
    (line_id, customer_id, bank_account_id, account_name, account_number, bank_code,
     customer_line_name, amount, note, created_by, batch_id)
  values
    (v.line_id, v.customer_id, v.id, v.account_name, v.account_number, v.bank_code,
     v.c_line_name, round(p_amount, 2), nullif(trim(p_note), ''), auth.uid(), p_batch_id)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.create_payout(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.create_payout(uuid, numeric, text, uuid) to authenticated;

-- ===== 008_customer_create_supervisor.sql =====
-- รันครั้งเดียวใน SQL Editor
-- เพิ่มลูกค้าใหม่ได้เฉพาะผู้ดูแล (ในสายของตัวเอง) และเจ้าของเว็บ
-- สมาชิกและแอดมินยังค้นหา ดู แจ้งโอน และเพิ่ม/แก้บัญชีของลูกค้าที่มีอยู่ได้เหมือนเดิม

create or replace function app.can_add_customer(p_line uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role = 'owner' or (p.role = 'supervisor' and p.line_id = p_line))
  )
$$;
grant execute on function app.can_add_customer(uuid) to authenticated;

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (app.can_add_customer(line_id));

-- ===== 009_delete_customer.sql =====
-- รันครั้งเดียวใน SQL Editor (ต้องรัน 008 ก่อน)
-- ลบลูกค้า: เฉพาะผู้ดูแล (ในสายของตัวเอง) และเจ้าของเว็บ
-- ลบไม่ได้ถ้ายังมีรายการค้าง (รอโอน / โอนแล้วรอยืนยัน / ส่งกลับแก้ไข)
-- ลบพร้อมบัญชีและประวัติรายการ (ยืนยันแล้ว / ยกเลิก) และบันทึกสำเนาไว้ใน audit_logs

create or replace function public.delete_customer(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_active int;
  v_pay int;
  v_acct int;
  v_snapshot jsonb;
begin
  select * into c from public.customers where id = p_id for update;
  if not found or not app.can_add_customer(c.line_id) then
    raise exception 'ไม่มีสิทธิ์ลบลูกค้านี้' using errcode = 'P0001';
  end if;

  select count(*) into v_active from public.payout_requests
  where customer_id = p_id and status in ('pending', 'transferred', 'returned');
  if v_active > 0 then
    raise exception 'ลูกค้านี้ยังมีรายการค้าง % รายการ ยืนยันหรือยกเลิกให้หมดก่อนจึงจะลบได้', v_active using errcode = 'P0001';
  end if;

  -- เก็บสำเนาไว้ในประวัติการแก้ไขก่อนลบ
  v_snapshot := jsonb_build_object(
    'customer', to_jsonb(c),
    'accounts', coalesce((select jsonb_agg(to_jsonb(b)) from public.bank_accounts b where b.customer_id = p_id), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(to_jsonb(p)) from public.payout_requests p where p.customer_id = p_id), '[]'::jsonb));

  delete from public.payout_requests where customer_id = p_id;
  get diagnostics v_pay = row_count;
  delete from public.bank_accounts where customer_id = p_id;
  get diagnostics v_acct = row_count;
  delete from public.customers where id = p_id;

  insert into public.audit_logs (actor_id, line_id, action, target_table, target_id, detail)
  values (auth.uid(), c.line_id, 'delete', 'customers', p_id, v_snapshot);

  return jsonb_build_object('payouts', v_pay, 'accounts', v_acct);
end $$;

revoke execute on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated;
