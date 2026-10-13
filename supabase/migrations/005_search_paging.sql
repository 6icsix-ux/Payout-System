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
