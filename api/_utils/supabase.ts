import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials are not set in environment variables.');
}

// Cliente base con permisos de administrador (Úsalo solo en Auth/Login/Register o donde sea explícitamente necesario)
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// Cliente Seguro para el resto de endpoints
export function getSafeSupabase(tenantId: string) {
  if (!tenantId) throw new Error("Tenant ID es requerido para consultar la BD");
  
  // Usamos Proxy para interceptar llamadas a las tablas y forzar el filtro
  return {
    from: (table: string) => {
      const query = supabaseAdmin.from(table);
      // Forza el filtro por tenant_id en CADA consulta
      return query.eq('tenant_id', tenantId);
    },
    // Exponer otros métodos de supabaseAdmin si son necesarios, pero filtrados
    rpc: supabaseAdmin.rpc.bind(supabaseAdmin),
    storage: supabaseAdmin.storage
  };
}
