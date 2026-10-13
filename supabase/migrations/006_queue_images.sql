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
