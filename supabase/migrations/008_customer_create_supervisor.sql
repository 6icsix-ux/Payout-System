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
