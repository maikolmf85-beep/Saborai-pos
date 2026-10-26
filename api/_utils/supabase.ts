import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials are not set in environment variables.');
}

// Cliente base con permisos de administrador (Úsalo solo en Auth/Login/Register o donde sea explícitamente necesario)
export const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// Cliente aislado para signInWithPassword. Nunca usarlo para consultas administrativas.
export const supabaseAuth = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

// Cliente Seguro para el resto de endpoints con aislamiento forzado de tenant
export function getSafeSupabase(tenantId: string) {
  if (!tenantId) throw new Error("Tenant ID es requerido para consultar la BD");
  
  return {
    from: (table: string) => {
      const builder = supabaseAdmin.from(table);
      return new Proxy(builder, {
        get(target: any, prop: string | symbol) {
          const original = target[prop];
          if (typeof original !== 'function') return original;

          if (prop === 'select' || prop === 'delete') {
            return (...args: any[]) => {
              const query = original.apply(target, args);
              return query.eq('tenant_id', tenantId);
            };
          }
          if (prop === 'update') {
            return (values: any, ...args: any[]) => {
              const query = original.apply(target, [values, ...args]);
              return query.eq('tenant_id', tenantId);
            };
          }
          if (prop === 'insert' || prop === 'upsert') {
            return (values: any, ...args: any[]) => {
              const withTenant = Array.isArray(values)
                ? values.map(v => ({ ...v, tenant_id: tenantId }))
                : { ...values, tenant_id: tenantId };
              return original.apply(target, [withTenant, ...args]);
            };
          }
          return original.bind(target);
        }
      });
    },
    rpc: supabaseAdmin.rpc.bind(supabaseAdmin),
    storage: supabaseAdmin.storage
  };
}
