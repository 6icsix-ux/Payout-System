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
