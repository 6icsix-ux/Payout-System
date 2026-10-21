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
