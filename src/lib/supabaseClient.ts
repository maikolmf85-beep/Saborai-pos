import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  /^https:\/\/[^\s]+\.supabase\.co$/.test(supabaseUrl) && supabaseAnonKey.length > 20
);

// Realtime es opcional para que el POS pueda arrancar y trabajar offline si una
// instalación aún no ha configurado las variables públicas de Supabase.
export const supabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
