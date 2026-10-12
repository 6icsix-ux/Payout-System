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
