/**
 * Integración con el catálogo oficial CABYS del Ministerio de Hacienda (API pública).
 * https://api.hacienda.go.cr/fe/cabys?q=<texto>
 */

export interface CabysResult {
  codigo: string;
  descripcion: string;
  impuesto: number; // porcentaje (13, 4, 2, 1, 0...)
  categoria: string; // categoría más específica
  score?: number;
}

const API = 'https://api.hacienda.go.cr/fe/cabys';

const norm = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ');

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'en', 'al', 'a', 'un', 'una', 'por', 'para']);

const tokens = (s: string) => norm(s).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));

const stem = (t: string) => t.slice(0, Math.max(4, t.length - 2));

const cache = new Map<string, CabysResult[]>();

async function rawSearch(q: string): Promise<CabysResult[]> {
  const key = norm(q).trim();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(`${API}?q=${encodeURIComponent(q.trim())}`);
    if (!res.ok) return [];
    const data = await res.json();
    const list: CabysResult[] = (data?.cabys || []).map((c: any) => ({
      codigo: String(c.codigo),
      descripcion: String(c.descripcion || ''),
      impuesto: Number(c.impuesto ?? 13),
      categoria: Array.isArray(c.categorias) && c.categorias.length ? String(c.categorias[c.categorias.length - 1]) : ''
    })).filter((c: CabysResult) => /^\d{13}$/.test(c.codigo));
    cache.set(key, list);
    return list;
  } catch {
    return [];
  }
}

function scoreResult(r: CabysResult, queryTokens: string[], category?: string): number {
  const text = norm(`${r.descripcion} ${r.categoria}`);
  const descTokens = tokens(r.descripcion).map(stem);
  let score = 0;
  for (const qt of queryTokens) {
    const st = stem(qt);
    if (descTokens.includes(st)) score += 3;
    else if (text.includes(st)) score += 1;
  }
  // Penaliza descripciones muy largas / genéricas (prefiere coincidencias precisas)
  score -= Math.max(0, descTokens.length - queryTokens.length) * 0.15;
  // Pequeño sesgo: alimentos/bebidas preparados para el consumo en restaurante
  if (category && norm(category).includes('bebida') && /jugo|bebida|refresco|gaseosa|agua|cafe|te /.test(text)) score += 0.5;
  return score;
}

/** Busca códigos CABYS para un texto libre (nombre de producto). Devuelve resultados ordenados por relevancia. */
export async function searchCabys(query: string, category?: string, limit = 8): Promise<CabysResult[]> {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return [];

  // 1) Consulta con el texto completo
  let results = await rawSearch(query);

  // 2) Si hay pocos resultados, consulta por cada palabra significativa y combina
  if (results.length < 5) {
    const extra = await Promise.all(qTokens.filter(t => t.length > 3).slice(0, 3).map(t => rawSearch(t)));
    const merged = new Map<string, CabysResult>();
    [...results, ...extra.flat()].forEach(r => merged.set(r.codigo, r));
    results = [...merged.values()];
  }

  return results
    .map(r => ({ ...r, score: scoreResult(r, qTokens, category) }))
    .filter(r => (r.score || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

/** Mejor sugerencia para un producto, o null si no hay coincidencia confiable. */
export async function suggestCabys(name: string, category?: string): Promise<CabysResult | null> {
  const results = await searchCabys(name, category, 1);
  const best = results[0];
  const qTokens = tokens(name);
  // Confianza mínima: al menos una palabra del nombre coincide de forma exacta (3 puntos)
  if (!best || (best.score || 0) < Math.min(3, qTokens.length * 3)) return null;
  return best;
}

export const isValidCabys = (code?: string) => !!code && /^\d{13}$/.test(code) && !/^0+$/.test(code);
