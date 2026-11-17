-- 사 주세요 요청 '보류' 상태 + 구성원 프로필 사진
alter table public.wishes drop constraint if exists wishes_status_check;
alter table public.wishes add constraint wishes_status_check check (status in ('원함','요청','승인','거절','보류','구매함'));

drop policy if exists wishes_update on public.wishes;
create policy wishes_update on public.wishes for update to authenticated
  using (private.is_adult(household_id) or (requested_by = private.my_member_id(household_id) and status in ('요청','거절','보류')))
  with check (private.is_adult(household_id) or (requested_by = private.my_member_id(household_id) and status = '요청'));
drop policy if exists wishes_delete on public.wishes;
create policy wishes_delete on public.wishes for delete to authenticated using (
  private.is_adult(household_id) or (requested_by = private.my_member_id(household_id) and status in ('요청','거절','보류')));

-- 프로필 사진: storage 'avatars' 버킷의 {household_id}/{member_id}.jpg
alter table public.members add column if not exists avatar_path text check (avatar_path is null or char_length(avatar_path) <= 200);
grant update (display_name, color, avatar_path) on public.members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- 같은 가족만 볼 수 있고, 올리기·지우기는 본인 사진만(어른은 자녀 사진도)
create policy avatars_read on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and private.is_member(((storage.foldername(name))[1])::uuid));
create policy avatars_write on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and exists (
    select 1 from public.members m
    where m.household_id = ((storage.foldername(name))[1])::uuid
      and name = m.household_id || '/' || m.id || '.jpg'
      and (m.user_id = auth.uid() or (m.role = 'child' and private.is_adult(m.household_id)))));
create policy avatars_update on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and exists (
    select 1 from public.members m
    where name = m.household_id || '/' || m.id || '.jpg'
      and (m.user_id = auth.uid() or (m.role = 'child' and private.is_adult(m.household_id)))));
create policy avatars_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and exists (
    select 1 from public.members m
    where name = m.household_id || '/' || m.id || '.jpg'
      and (m.user_id = auth.uid() or (m.role = 'child' and private.is_adult(m.household_id)))));
