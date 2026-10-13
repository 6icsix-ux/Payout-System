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
