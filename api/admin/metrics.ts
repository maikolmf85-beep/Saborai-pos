import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin as supabase } from '../_utils/supabase.js';
import { handleOptions, requireAuth, setCorsHeaders } from '../_utils/security.js';
import { isGlobalAdminUser, parseGlobalAdminUserIds } from '../_utils/globalAdminAuthorization.js';
import {
  ADMIN_RESTAURANT_BRANCH_SELECT,
  ADMIN_RESTAURANT_SELECT,
  ADMIN_RESTAURANT_SUBSCRIPTION_SELECT,
  type AdminRestaurantBranch,
  type AdminRestaurantSubscription,
  mapAdminRestaurantBranch,
  mapAdminRestaurantSummary,
  mapAdminRestaurantSubscription,
  parseAdminRestaurantPagination
} from '../_utils/adminRestaurants.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // El acceso global depende únicamente de una lista explícita del servidor.
  const globalAdminUserIds = parseGlobalAdminUserIds(process.env.SABORAI_GLOBAL_ADMIN_USER_IDS);
  if (globalAdminUserIds.size === 0) {
    return res.status(503).json({ error: 'El acceso global no está configurado.' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (auth.employeeId || !isGlobalAdminUser(auth.userId, globalAdminUserIds)) {
    return res.status(403).json({ error: 'No tienes permisos para acceder a información global.' });
  }

  const rawAction = req.query.action;
  const action = rawAction === undefined
    ? 'metrics'
    : typeof rawAction === 'string'
      ? rawAction
      : null;
  if (!action || (action !== 'metrics' && action !== 'restaurants')) {
    return res.status(400).json({ error: 'La acción solicitada no es válida.' });
  }

  try {
    if (action === 'restaurants') {
      const pagination = parseAdminRestaurantPagination(req.query.limit, req.query.offset);
      if (!pagination) {
        return res.status(400).json({ error: 'La paginación solicitada no es válida.' });
      }

      const { data, error, count } = await supabase
        .from('tenants')
        .select(ADMIN_RESTAURANT_SELECT, { count: 'exact' })
        .order('id', { ascending: true })
        .range(pagination.offset, pagination.offset + pagination.limit - 1);

      if (error) {
        console.error('Error cargando el directorio global de restaurantes:', error.message);
        return res.status(500).json({ error: 'No se pudo cargar el directorio de restaurantes.' });
      }

      const restaurants = (Array.isArray(data) ? data : [])
        .map(mapAdminRestaurantSummary)
        .filter((restaurant): restaurant is NonNullable<typeof restaurant> => restaurant !== null);
      const restaurantIds = restaurants.map((restaurant) => restaurant.id);
      const subscriptionsByTenant = new Map<string, AdminRestaurantSubscription>();
      const branchesByTenant = new Map<string, AdminRestaurantBranch[]>();

      if (restaurantIds.length > 0) {
        const [subscriptionsResult, branchesResult] = await Promise.all([
          supabase
            .from('subscriptions')
            .select(ADMIN_RESTAURANT_SUBSCRIPTION_SELECT)
            .in('tenant_id', restaurantIds),
          supabase
            .from('pos_branches')
            .select(ADMIN_RESTAURANT_BRANCH_SELECT)
            .in('tenant_id', restaurantIds)
            .order('name', { ascending: true })
        ]);

        if (subscriptionsResult.error || branchesResult.error) {
          console.error('Error cargando detalles globales de restaurantes:',
            subscriptionsResult.error?.message || branchesResult.error?.message);
          return res.status(500).json({ error: 'No se pudieron cargar los detalles de los restaurantes.' });
        }

        for (const value of Array.isArray(subscriptionsResult.data) ? subscriptionsResult.data : []) {
          const mapped = mapAdminRestaurantSubscription(value);
          if (mapped && !subscriptionsByTenant.has(mapped.tenantId)) {
            subscriptionsByTenant.set(mapped.tenantId, mapped.subscription);
          }
        }

        for (const value of Array.isArray(branchesResult.data) ? branchesResult.data : []) {
          const mapped = mapAdminRestaurantBranch(value);
          if (!mapped) continue;
          const branches = branchesByTenant.get(mapped.tenantId) || [];
          branches.push(mapped.branch);
          branchesByTenant.set(mapped.tenantId, branches);
        }
      }

      const restaurantsWithDetails = restaurants.map((restaurant) => ({
        ...restaurant,
        subscription: subscriptionsByTenant.get(restaurant.id) || null,
        branches: branchesByTenant.get(restaurant.id) || []
      }));
      const totalCount = typeof count === 'number' ? count : pagination.offset + restaurants.length;

      return res.status(200).json({
        restaurants: restaurantsWithDetails,
        totalCount,
        limit: pagination.limit,
        offset: pagination.offset,
        hasMore: pagination.offset + restaurants.length < totalCount
      });
    }

    const { count, error } = await supabase
      .from('demo_leads')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error fetching leads:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ leadsCount: count || 0 });
  } catch (error: unknown) {
    console.error('Error en admin/metrics:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
