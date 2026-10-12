// Conexión con Supabase (Project Settings → API en el panel de Supabase).
//
// Las dos son públicas: van al navegador de todos los usuarios. Lo que protege
// los datos son las políticas RLS de supabase/schema.sql. La "service_role" key
// NUNCA va acá.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
