import React, { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  Users
} from 'lucide-react';

type AdminRestaurantPlan = 'express' | 'pro' | 'multibranch' | null;
type AdminSubscriptionMode = 'DEMO' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;

interface AdminRestaurantSubscription {
  mode: AdminSubscriptionMode;
  plan: AdminRestaurantPlan;
  trialEndsAt: string | null;
  activatedAt: string | null;
}

interface AdminRestaurantBranch {
  id: string;
  name: string;
  code: string;
  isActive: boolean | null;
}

interface AdminRestaurant {
  id: string;
  name: string;
  email: string;
  phone: string;
  plan: AdminRestaurantPlan;
  onboardingCompleted: boolean | null;
  subscription: AdminRestaurantSubscription | null;
  branches: AdminRestaurantBranch[];
}

interface AdminRestaurantPage {
  restaurants: AdminRestaurant[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAdminSubscriptionMode(value: unknown): value is AdminSubscriptionMode {
  return value === null || value === 'DEMO' || value === 'TRIAL' || value === 'ACTIVE'
    || value === 'PAST_DUE' || value === 'CANCELLED';
}

function isAdminRestaurantSubscription(value: unknown): value is AdminRestaurantSubscription {
  if (!isRecord(value)) return false;
  return isAdminSubscriptionMode(value.mode)
    && (value.plan === null || value.plan === 'express' || value.plan === 'pro' || value.plan === 'multibranch')
    && (value.trialEndsAt === null || typeof value.trialEndsAt === 'string')
    && (value.activatedAt === null || typeof value.activatedAt === 'string');
}

function isAdminRestaurantBranch(value: unknown): value is AdminRestaurantBranch {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.code === 'string'
    && (value.isActive === null || typeof value.isActive === 'boolean');
}

function isAdminRestaurant(value: unknown): value is AdminRestaurant {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.email === 'string'
    && typeof value.phone === 'string'
    && (value.plan === null || value.plan === 'express' || value.plan === 'pro' || value.plan === 'multibranch')
    && (value.onboardingCompleted === null || typeof value.onboardingCompleted === 'boolean')
    && (value.subscription === null || isAdminRestaurantSubscription(value.subscription))
    && Array.isArray(value.branches)
    && value.branches.every(isAdminRestaurantBranch);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return isRecord(value) ? value : {};
}

async function fetchRestaurantPage(token: string, offset: number): Promise<AdminRestaurantPage> {
  const query = new URLSearchParams({
    action: 'restaurants',
    limit: String(PAGE_SIZE),
    offset: String(offset)
  });
  const response = await fetch(`/api/admin/metrics?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string'
      ? payload.error
      : 'No se pudo cargar el directorio de restaurantes.');
  }
  if (!Array.isArray(payload.restaurants)) {
    throw new Error('La respuesta del directorio no tiene el formato esperado.');
  }

  const restaurants = payload.restaurants.filter(isAdminRestaurant);
  const totalCount = typeof payload.totalCount === 'number' && Number.isSafeInteger(payload.totalCount)
    ? payload.totalCount
    : restaurants.length;
  const pageOffset = typeof payload.offset === 'number' && Number.isSafeInteger(payload.offset)
    ? payload.offset
    : offset;
  const pageLimit = typeof payload.limit === 'number' && Number.isSafeInteger(payload.limit)
    ? payload.limit
    : PAGE_SIZE;

  return {
    restaurants,
    totalCount,
    offset: pageOffset,
    limit: pageLimit,
    hasMore: payload.hasMore === true
  };
}

function planLabel(plan: AdminRestaurantPlan): string {
  if (plan === 'express') return 'Express';
  if (plan === 'pro') return 'Pro';
  if (plan === 'multibranch') return 'Multisucursal';
  return 'No indicado';
}

function subscriptionModeLabel(mode: AdminSubscriptionMode): string {
  if (mode === 'DEMO') return 'Demostración';
  if (mode === 'TRIAL') return 'Prueba';
  if (mode === 'ACTIVE') return 'Activa';
  if (mode === 'PAST_DUE') return 'Pago pendiente';
  if (mode === 'CANCELLED') return 'Cancelada';
  return 'Sin dato';
}

function subscriptionModeClass(mode: AdminSubscriptionMode): string {
  if (mode === 'ACTIVE') return 'border-emerald-700/60 bg-emerald-500/10 text-emerald-300';
  if (mode === 'TRIAL') return 'border-sky-700/60 bg-sky-500/10 text-sky-300';
  if (mode === 'PAST_DUE') return 'border-amber-700/60 bg-amber-500/10 text-amber-300';
  if (mode === 'CANCELLED') return 'border-rose-700/60 bg-rose-500/10 text-rose-300';
  return 'border-stone-700 bg-stone-800 text-stone-300';
}

function adminDateLabel(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin dato';
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium',
    timeZone: 'America/Costa_Rica'
  }).format(new Date(value));
}

export const SuperAdminBackoffice: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expandedRestaurantId, setExpandedRestaurantId] = useState<string | null>(null);
  const [leadsCount, setLeadsCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword })
      });
      const loginData = await readJson(loginResponse);
      if (!loginResponse.ok || typeof loginData.token !== 'string') {
        throw new Error('Correo o contraseña incorrectos.');
      }

      const token = loginData.token;
      const [metricsResponse, firstPage] = await Promise.all([
        fetch('/api/admin/metrics', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchRestaurantPage(token, 0)
      ]);
      const metricsData = await readJson(metricsResponse);
      if (!metricsResponse.ok) {
        throw new Error(typeof metricsData.error === 'string'
          ? metricsData.error
          : 'La cuenta no tiene autorización global.');
      }

      setAccessToken(token);
      setLeadsCount(typeof metricsData.leadsCount === 'number' ? metricsData.leadsCount : 0);
      setRestaurants(firstPage.restaurants);
      setTotalCount(firstPage.totalCount);
      setOffset(firstPage.offset);
      setHasMore(firstPage.hasMore);
      setIsAuthenticated(true);
      setLoginPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'No se pudo verificar el acceso.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadPage = async (nextOffset: number) => {
    if (!accessToken || nextOffset < 0) return;
    setPageError(null);
    setIsLoadingPage(true);
    try {
      const page = await fetchRestaurantPage(accessToken, nextOffset);
      setRestaurants(page.restaurants);
      setTotalCount(page.totalCount);
      setOffset(page.offset);
      setHasMore(page.hasMore);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No se pudo actualizar el directorio.');
    } finally {
      setIsLoadingPage(false);
    }
  };

  const handleLogout = () => {
    setAccessToken('');
    setRestaurants([]);
    setTotalCount(0);
    setOffset(0);
    setHasMore(false);
    setExpandedRestaurantId(null);
    setLeadsCount(0);
    setIsAuthenticated(false);
    setLoginEmail('');
    setLoginPassword('');
    setLoginError(null);
    setPageError(null);
  };

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const filteredRestaurants = restaurants.filter((restaurant) => {
    if (!normalizedSearch) return true;
    const searchableValues = [
      restaurant.name,
      restaurant.email,
      restaurant.phone,
      planLabel(restaurant.plan),
      subscriptionModeLabel(restaurant.subscription?.mode ?? null),
      ...restaurant.branches.flatMap((branch) => [branch.name, branch.code])
    ];
    return searchableValues
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  });
  const firstRecord = totalCount === 0 ? 0 : offset + 1;
  const lastRecord = offset + restaurants.length;
  const pageNumber = totalCount === 0 ? 0 : Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.ceil(totalCount / PAGE_SIZE);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center p-4 font-sans selection:bg-[#a9b994]/30">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-stone-950 to-stone-950 pointer-events-none" />
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-stone-900/70 backdrop-blur-xl border border-stone-800 p-8 rounded-3xl shadow-2xl flex flex-col items-center relative z-10"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white mb-2">Acceso restringido</h1>
          <p className="text-stone-400 text-sm text-center mb-8">
            El panel global está disponible únicamente para cuentas autorizadas por el servidor.
          </p>

          <label className="sr-only" htmlFor="global-admin-email">Correo de la cuenta</label>
          <input
            id="global-admin-email"
            type="email"
            value={loginEmail}
            onChange={(event) => setLoginEmail(event.target.value)}
            placeholder="Correo de la cuenta"
            autoComplete="username"
            required
            className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 mb-3"
          />
          <label className="sr-only" htmlFor="global-admin-password">Contraseña</label>
          <input
            id="global-admin-password"
            type="password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="Contraseña"
            autoComplete="current-password"
            required
            className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500"
          />

          {loginError && (
            <div role="alert" className="w-full mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-semibold">
              {loginError}
            </div>
          )}
          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full mt-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-wait text-white rounded-xl text-sm font-black transition-colors"
          >
            {isLoggingIn ? 'Verificando acceso…' : 'Ingresar al panel'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans">
      <header className="border-b border-stone-800 bg-stone-950/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-emerald-400 text-xs font-black uppercase tracking-[0.18em]">Saborai · Administración global</p>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-1">Restaurantes registrados</h1>
            <p className="text-sm text-stone-400 mt-2">Vista de solo lectura cargada del servidor. No se editan datos desde este panel.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPage(offset)}
              disabled={isLoadingPage}
              className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 border border-stone-700 text-stone-200 rounded-xl text-sm font-bold transition-colors inline-flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingPage ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2.5 bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-200 rounded-xl text-sm font-bold transition-colors inline-flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {pageError && (
          <div role="alert" className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
            {pageError}
          </div>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Resumen global">
          <div className="p-6 rounded-3xl bg-stone-900 border border-stone-800">
            <div className="flex items-center justify-between text-stone-400 text-xs font-bold uppercase tracking-wider">
              <span>Restaurantes en el directorio</span>
              <Building2 className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="mt-3 text-4xl font-black text-white">{totalCount.toLocaleString('es-CR')}</p>
            <p className="mt-2 text-xs text-stone-500">Conteo total informado por el servidor</p>
          </div>
          <div className="p-6 rounded-3xl bg-stone-900 border border-stone-800">
            <div className="flex items-center justify-between text-stone-400 text-xs font-bold uppercase tracking-wider">
              <span>Leads de demostración</span>
              <Users className="w-5 h-5 text-teal-400" />
            </div>
            <p className="mt-3 text-4xl font-black text-white">{leadsCount.toLocaleString('es-CR')}</p>
            <p className="mt-2 text-xs text-stone-500">Conteo actual de la tabla de leads</p>
          </div>
        </section>

        <section className="rounded-3xl bg-stone-900 border border-stone-800 overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-stone-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-white">Directorio de restaurantes</h2>
              <p className="text-xs text-stone-500 mt-1">Mostrando {firstRecord.toLocaleString('es-CR')}–{lastRecord.toLocaleString('es-CR')} de {totalCount.toLocaleString('es-CR')} registros.</p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Filtrar esta página por nombre o contacto"
                aria-label="Filtrar los restaurantes de esta página"
                className="w-full pl-10 pr-3 py-2.5 bg-stone-950 border border-stone-800 rounded-xl text-sm text-stone-100 focus:outline-none focus:border-emerald-500/60 placeholder:text-stone-600"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-stone-400 uppercase text-[10px] tracking-wider">
                  <th scope="col" className="px-5 py-4 font-black">Restaurante</th>
                  <th scope="col" className="px-5 py-4 font-black">Contacto</th>
                  <th scope="col" className="px-5 py-4 font-black">Plan</th>
                  <th scope="col" className="px-5 py-4 font-black">Onboarding</th>
                  <th scope="col" className="px-5 py-4 font-black">Suscripción</th>
                  <th scope="col" className="px-5 py-4 font-black">Sucursales y detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/70">
                {isLoadingPage ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-stone-400">Cargando datos del servidor…</td></tr>
                ) : filteredRestaurants.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-stone-400">
                    {restaurants.length === 0 ? 'No hay restaurantes registrados.' : 'No hay coincidencias en esta página.'}
                  </td></tr>
                ) : filteredRestaurants.map((restaurant) => (
                  <React.Fragment key={restaurant.id}>
                    <tr className="hover:bg-stone-800/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center text-emerald-300 font-black">
                            {(restaurant.name.trim()[0] || 'R').toLocaleUpperCase()}
                          </span>
                          <div>
                            <div className="font-bold text-white">{restaurant.name}</div>
                            <div className="text-[11px] text-stone-500 font-mono mt-0.5">{restaurant.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-stone-300">
                        <div>{restaurant.email || 'Sin correo'}</div>
                        <div className="text-xs text-stone-500 mt-1">{restaurant.phone || 'Sin teléfono'}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 rounded-lg bg-stone-800 text-stone-200 border border-stone-700 text-xs font-bold">
                          {planLabel(restaurant.plan)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {restaurant.onboardingCompleted === null ? (
                          <span className="text-stone-500 text-xs">Sin dato</span>
                        ) : restaurant.onboardingCompleted ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-300 text-xs font-bold"><CheckCircle2 className="w-4 h-4" />Completado</span>
                        ) : (
                          <span className="text-amber-300 text-xs font-bold">Pendiente</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-lg border text-xs font-bold ${subscriptionModeClass(restaurant.subscription?.mode ?? null)}`}>
                          {subscriptionModeLabel(restaurant.subscription?.mode ?? null)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-stone-300 text-xs mb-2">
                          {restaurant.branches.length.toLocaleString('es-CR')} {restaurant.branches.length === 1 ? 'sucursal' : 'sucursales'}
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedRestaurantId((current) => current === restaurant.id ? null : restaurant.id)}
                          aria-expanded={expandedRestaurantId === restaurant.id}
                          aria-controls={`restaurant-details-${restaurant.id}`}
                          className="text-emerald-300 hover:text-emerald-200 text-xs font-bold underline underline-offset-4"
                        >
                          {expandedRestaurantId === restaurant.id ? 'Ocultar detalle' : 'Ver detalle'}
                        </button>
                      </td>
                    </tr>
                    {expandedRestaurantId === restaurant.id && (
                      <tr id={`restaurant-details-${restaurant.id}`} className="bg-stone-950/60">
                        <td colSpan={6} className="px-5 py-5">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <section className="rounded-2xl border border-stone-800 bg-stone-900/70 p-4" aria-label={`Suscripción de ${restaurant.name}`}>
                              <h3 className="text-xs font-black uppercase tracking-wider text-stone-300">Detalle de suscripción</h3>
                              {restaurant.subscription ? (
                                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                                  <div><dt className="text-stone-500">Estado</dt><dd className="mt-1 text-stone-200 font-bold">{subscriptionModeLabel(restaurant.subscription.mode)}</dd></div>
                                  <div><dt className="text-stone-500">Plan de suscripción</dt><dd className="mt-1 text-stone-200 font-bold">{planLabel(restaurant.subscription.plan)}</dd></div>
                                  <div><dt className="text-stone-500">Activada</dt><dd className="mt-1 text-stone-200">{adminDateLabel(restaurant.subscription.activatedAt)}</dd></div>
                                  <div><dt className="text-stone-500">Fin de prueba</dt><dd className="mt-1 text-stone-200">{adminDateLabel(restaurant.subscription.trialEndsAt)}</dd></div>
                                </dl>
                              ) : (
                                <p className="mt-3 text-xs text-stone-500">No hay una suscripción vinculada a este restaurante.</p>
                              )}
                            </section>
                            <section className="rounded-2xl border border-stone-800 bg-stone-900/70 p-4" aria-label={`Sucursales de ${restaurant.name}`}>
                              <h3 className="text-xs font-black uppercase tracking-wider text-stone-300">Sucursales registradas</h3>
                              {restaurant.branches.length > 0 ? (
                                <ul className="mt-3 space-y-2">
                                  {restaurant.branches.map((branch) => (
                                    <li key={branch.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="text-stone-200 font-semibold">
                                        {branch.name}{branch.code ? <span className="text-stone-500 font-mono"> · {branch.code}</span> : null}
                                      </span>
                                      <span className={branch.isActive === true ? 'text-emerald-300' : branch.isActive === false ? 'text-stone-400' : 'text-stone-500'}>
                                        {branch.isActive === true ? 'Activa' : branch.isActive === false ? 'Inactiva' : 'Sin estado'}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-3 text-xs text-stone-500">No hay sucursales registradas.</p>
                              )}
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-stone-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-stone-500">Página {pageNumber.toLocaleString('es-CR')} de {pageCount.toLocaleString('es-CR')} · El filtro busca solo dentro de la página actual.</p>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || isLoadingPage}
                aria-label="Página anterior"
                className="p-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-200 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void loadPage(offset + PAGE_SIZE)}
                disabled={!hasMore || isLoadingPage}
                aria-label="Página siguiente"
                className="p-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-200 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
