// Conexión con Supabase (Project Settings → API en el panel de Supabase).
//
// Las dos son públicas: van al navegador de todos los usuarios. Lo que protege
// los datos son las políticas RLS de supabase/schema.sql. La "service_role" key
// NUNCA va acá.
const SUPABASE_URL = 'https://mqvdzitycvqqfmkujkua.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xdmR6aXR5Y3ZxcWZta3Vqa3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjU5ODIsImV4cCI6MjEwNzMwMTk4Mn0.wq4Mvo_woD-uArY-r5VGgoSulpXDsP3umZud2ZSZp4g';
