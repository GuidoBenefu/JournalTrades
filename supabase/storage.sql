-- Capturas de los trades y de los setups en Supabase Storage.
--
-- Se corre una vez en el SQL Editor, después de schema.sql (usa public.has_access).
-- Se puede volver a correr sin romper nada.
--
-- Bucket privado `journal-images`: cada usuario tiene su carpeta `<user_id>/` y
-- cada archivo se llama como el imageId del trade (sin extensión).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-images', 'journal-images', false, 5 * 1024 * 1024,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ver y bajar: solo lo de su carpeta.
drop policy if exists "capturas: leer las propias" on storage.objects;
create policy "capturas: leer las propias" on storage.objects
  for select to authenticated
  using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Subir: solo a su carpeta y con la prueba vigente o Pro.
drop policy if exists "capturas: subir las propias" on storage.objects;
create policy "capturas: subir las propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'journal-images' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.has_access());

-- Borrar: solo lo de su carpeta (también con la prueba vencida, para poder limpiar).
drop policy if exists "capturas: borrar las propias" on storage.objects;
create policy "capturas: borrar las propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'journal-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
