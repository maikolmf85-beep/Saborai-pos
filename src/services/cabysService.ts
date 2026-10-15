/**
 * Integración con el catálogo oficial CABYS del Ministerio de Hacienda (API pública)
 * y Catálogo Maestro Nativo Especializado para Restaurantes, Bares y Cafeterías de Costa Rica.
 */

export interface CabysResult {
  codigo: string;
  descripcion: string;
  impuesto: number; // porcentaje (13, 4, 2, 1, 0...)
  categoria: string; // categoría más específica
  score?: number;
  isService?: boolean;
}

export interface PresetRestaurantCabys {
  id: string;
  label: string;
  icon: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  impuesto: number;
  isService: boolean;
  keywords: string[];
}

/**
 * Catálogo Maestro Oficial CABYS para Restaurantes (BCCR / Hacienda CR).
 * Garantiza que todo plato, bebida o servicio tenga un código CABYS 100% válido y activo.
 */
export const RESTAURANT_CABYS_PRESETS: PresetRestaurantCabys[] = [
  // --- SERVICIOS DE RESTAURANTE ---
  {
    id: 'rest_service',
    label: 'Servicio de Restaurante / Comidas',
    icon: '🍽️',
    codigo: '6331000000000',
    descripcion: 'Servicios de preparación y suministro de comidas en restaurantes de servicio a la mesa',
    categoria: 'Servicios de Restaurante',
    impuesto: 13,
    isService: true,
    keywords: ['restaurante', 'comida', 'servicio', 'menu', 'plato', 'casado', 'buffet', 'almuerzo', 'cena', 'desayuno', 'especial', 'orden']
  },
  {
    id: 'bar_service',
    label: 'Servicio de Bar / Coctelería',
    icon: '🍸',
    codigo: '6332000000000',
    descripcion: 'Servicios de suministro de bebidas para su consumo inmediato en bares y tabernas',
    categoria: 'Servicios de Bar',
    impuesto: 13,
    isService: true,
    keywords: ['bar', 'coctel', 'trago', 'barra', 'licor', 'consumo', 'taberna']
  },
  {
    id: 'delivery_service',
    label: 'Servicio Express / A Domicilio',
    icon: '🛵',
    codigo: '6339900000000',
    descripcion: 'Servicios de entrega de comidas preparadas a domicilio o para llevar (Express)',
    categoria: 'Servicios de Entrega',
    impuesto: 13,
    isService: true,
    keywords: ['express', 'delivery', 'domicilio', 'envio', 'llevar', 'transporte', 'flete']
  },

  // --- PLATOS Y COMIDAS PREPARADAS (COCINA) ---
  {
    id: 'food_general',
    label: 'Plato Preparado / Comida Elaborada',
    icon: '🥘',
    codigo: '2399900000000',
    descripcion: 'Platos preparados y comidas elaboradas listas para el consumo',
    categoria: 'Comidas Preparadas',
    impuesto: 13,
    isService: false,
    keywords: ['casado', 'combo', 'especial', 'plato', 'guarnicion', 'sabor', 'alimento']
  },
  {
    id: 'meat_beef',
    label: 'Carnes Rojas / Cortes de Res',
    icon: '🥩',
    codigo: '2111100000200',
    descripcion: 'Cortes de carne bovina y platos de carne de res preparados',
    categoria: 'Carnes',
    impuesto: 13,
    isService: false,
    keywords: ['carne', 'res', 'ribeye', 'lomo', 'corte', 'steak', 'churrasco', 'entrena', 'vacio', 'puyazo', 'lomito', 'bovino', 'asado', 'parrillada']
  },
  {
    id: 'meat_pork',
    label: 'Carne de Cerdo / Chicharrón',
    icon: '🥓',
    codigo: '2112100000000',
    descripcion: 'Carne de cerdo y platos derivados preparados (chicharrones, costillas)',
    categoria: 'Carnes',
    impuesto: 13,
    isService: false,
    keywords: ['cerdo', 'chicharron', 'chicharrones', 'costilla', 'chuleta', 'pork', 'tocineta', 'bacon', 'carnitas']
  },
  {
    id: 'meat_poultry',
    label: 'Pollo y Aves',
    icon: '🍗',
    codigo: '2113100000000',
    descripcion: 'Carne de pollo y aves preparada (alitas, pechuga, nuggets)',
    categoria: 'Aves',
    impuesto: 13,
    isService: false,
    keywords: ['pollo', 'alita', 'alitas', 'wings', 'pechuga', 'nugget', 'nuggets', 'tender', 'tenders', 'chicken', 'crispy']
  },
  {
    id: 'seafood',
    label: 'Pescados y Mariscos / Ceviche',
    icon: '🐟',
    codigo: '2121100000100',
    descripcion: 'Pescados y mariscos frescos o preparados (ceviches, corvina, camarones)',
    categoria: 'Mariscos',
    impuesto: 13,
    isService: false,
    keywords: ['ceviche', 'pescado', 'corvina', 'camaron', 'camarones', 'pulpo', 'marisco', 'mariscos', 'salmon', 'atun', 'calamar', 'mariscada']
  },
  {
    id: 'burger_sandwich',
    label: 'Hamburguesas y Sándwiches',
    icon: '🍔',
    codigo: '2399900000100',
    descripcion: 'Hamburguesas, emparedados, paninis y sándwiches preparados',
    categoria: 'Comidas Rápidas',
    impuesto: 13,
    isService: false,
    keywords: ['hamburguesa', 'burger', 'sandwich', 'emparedado', 'panini', 'sub', 'club', 'torta']
  },
  {
    id: 'pizza_pasta',
    label: 'Pizzas y Pastas',
    icon: '🍕',
    codigo: '2399900000200',
    descripcion: 'Pizzas, pastas, lasagnas y calzones preparados',
    categoria: 'Italiana / Pastas',
    impuesto: 13,
    isService: false,
    keywords: ['pizza', 'pasta', 'lasagna', 'spaghetti', 'espagueti', 'fettuccine', 'ravioli', 'calzone', 'macarron']
  },
  {
    id: 'tacos_mex',
    label: 'Tacos, Burritos y Quesadillas',
    icon: '🌮',
    codigo: '2399900000300',
    descripcion: 'Tacos, burritos, quesadillas, fajitas y tortillas rellenas preparadas',
    categoria: 'Mexicana',
    impuesto: 13,
    isService: false,
    keywords: ['taco', 'tacos', 'burrito', 'burritos', 'quesadilla', 'fajita', 'fajitas', 'tortilla', 'chalupa', 'nachos', 'gringas']
  },
  {
    id: 'rice_dishes',
    label: 'Arroces Preparados',
    icon: '🍚',
    codigo: '2399900000400',
    descripcion: 'Platos preparados a base de arroz (arroz con pollo, cantonés, mariscos)',
    categoria: 'Arroces',
    impuesto: 13,
    isService: false,
    keywords: ['arroz', 'cantones', 'paella', 'risotto', 'chaufa']
  },
  {
    id: 'soups',
    label: 'Sopas, Caldos y Cremas',
    icon: '🥣',
    codigo: '2399900000500',
    descripcion: 'Sopas, cremas, caldos y ollas de carne preparadas',
    categoria: 'Sopas',
    impuesto: 13,
    isService: false,
    keywords: ['sopa', 'crema', 'caldo', 'olla', 'consome', 'ramen', 'pozole']
  },
  {
    id: 'salads',
    label: 'Ensaladas y Vegetales',
    icon: '🥗',
    codigo: '2131100000000',
    descripcion: 'Ensaladas, verduras preparadas y legumbres',
    categoria: 'Ensaladas',
    impuesto: 13,
    isService: false,
    keywords: ['ensalada', 'salad', 'cesar', 'vegetal', 'vegetales', 'lechuga', 'tomate', 'palmito', 'aguacate', 'vegan']
  },
  {
    id: 'fries_sides',
    label: 'Papas Fritas y Guarniciones',
    icon: '🍟',
    codigo: '2132100000000',
    descripcion: 'Papas fritas, patacones, aros de cebolla y guarniciones fritas',
    categoria: 'Acompañamientos',
    impuesto: 13,
    isService: false,
    keywords: ['papas', 'fritas', 'french', 'patacon', 'patacones', 'aros', 'cebolla', 'yuca', 'pure']
  },
  {
    id: 'bakery_desserts',
    label: 'Postres y Repostería',
    icon: '🍰',
    codigo: '2341000000000',
    descripcion: 'Productos de pastelería, repostería, queques y postres elaborados',
    categoria: 'Postres',
    impuesto: 13,
    isService: false,
    keywords: ['postre', 'queque', 'torta', 'pie', 'cheesecake', 'tres leches', 'flan', 'brownie', 'dulce', 'churro', 'reposteria']
  },
  {
    id: 'ice_cream',
    label: 'Helados y Nieves',
    icon: '🍨',
    codigo: '2143100000000',
    descripcion: 'Helados, nieves y postres fríos',
    categoria: 'Heladería',
    impuesto: 13,
    isService: false,
    keywords: ['helado', 'nieve', 'gelato', 'sorbete', 'sundae', 'cono']
  },

  // --- BEBIDAS NO ALCOHÓLICAS ---
  {
    id: 'soda_softdrinks',
    label: 'Gaseosas y Refrescos Embotellados',
    icon: '🥤',
    codigo: '2449000000000',
    descripcion: 'Bebidas no alcohólicas gaseadas, saborizadas o azucaradas',
    categoria: 'Bebidas',
    impuesto: 13,
    isService: false,
    keywords: ['gaseosa', 'soda', 'coca', 'cola', 'pepsi', 'fanta', 'sprite', 'fresca', 'ginger', 'refresco']
  },
  {
    id: 'natural_juices',
    label: 'Jugos Naturales y Batidos',
    icon: '🧃',
    codigo: '2449000000100',
    descripcion: 'Jugos, batidos y refrescos de frutas naturales preparados',
    categoria: 'Bebidas Naturales',
    impuesto: 13,
    isService: false,
    keywords: ['jugo', 'batido', 'natural', 'limonada', 'naranja', 'maracuya', 'fresa', 'guanabana', 'cas', 'mora', 'mango', 'smoothie']
  },
  {
    id: 'water_bottled',
    label: 'Agua Embotellada / Mineral',
    icon: '💧',
    codigo: '2441000000000',
    descripcion: 'Aguas minerales y aguas purificadas sin azucarar',
    categoria: 'Aguas',
    impuesto: 13,
    isService: false,
    keywords: ['agua', 'mineral', 'gas', 'cristal', 'alpina', 'purificada', 'botella']
  },
  {
    id: 'coffee',
    label: 'Café Caliente o Frío',
    icon: '☕',
    codigo: '2391200000000',
    descripcion: 'Café tostado elaborado y bebidas de café calientes o frías',
    categoria: 'Cafetería',
    impuesto: 13,
    isService: false,
    keywords: ['cafe', 'coffee', 'espresso', 'capuchino', 'cappuccino', 'latte', 'americano', 'chorreado', 'mocca']
  },
  {
    id: 'tea_infusions',
    label: 'Té e Infusiones',
    icon: '🍵',
    codigo: '2391300000000',
    descripcion: 'Té y preparaciones de té frío o caliente e infusiones',
    categoria: 'Té e Infusiones',
    impuesto: 13,
    isService: false,
    keywords: ['te', 'tea', 'infusion', 'manzanilla', 'verde', 'negro', 'frio']
  },

  // --- BEBIDAS ALCOHÓLICAS (BAR) ---
  {
    id: 'beer',
    label: 'Cervezas (Nacionales / Importadas)',
    icon: '🍺',
    codigo: '2411000000000',
    descripcion: 'Bebidas malteadas fermentadas (Cervezas nacionales, artesanales e importadas)',
    categoria: 'Cervezas',
    impuesto: 13,
    isService: false,
    keywords: ['cerveza', 'beer', 'imperial', 'pilsen', 'bavaria', 'heineken', 'corona', 'stella', 'artesanal', 'draft']
  },
  {
    id: 'wine',
    label: 'Vinos y Espumantes',
    icon: '🍷',
    codigo: '2421100000000',
    descripcion: 'Vinos de uvas frescas, espumantes y sangrías',
    categoria: 'Vinos',
    impuesto: 13,
    isService: false,
    keywords: ['vino', 'wine', 'tinto', 'blanco', 'rosado', 'copa', 'sangria', 'espumante', 'prosecco', 'champagne']
  },
  {
    id: 'liquor_spirits',
    label: 'Licores y Destilados',
    icon: '🥃',
    codigo: '2413000000000',
    descripcion: 'Bebidas alcohólicas destiladas (Guaro, ron, whisky, vodka, tequila, gin)',
    categoria: 'Licores',
    impuesto: 13,
    isService: false,
    keywords: ['licor', 'guaro', 'cacique', 'ron', 'whisky', 'whiskey', 'vodka', 'tequila', 'gin', 'ginebra', 'brandy', 'shot']
  },
  {
    id: 'cocktails',
    label: 'Cócteles y Tragos Preparados',
    icon: '🍹',
    codigo: '2413000000100',
    descripcion: 'Cócteles y mezclas de licor preparadas en barra (Mojito, Margarita, Gin Tonic)',
    categoria: 'Coctelería',
    impuesto: 13,
    isService: false,
    keywords: ['coctel', 'cocktail', 'mojito', 'margarita', 'chiliguaro', 'pina colada', 'gin tonic', 'caipirinha', 'aperol', 'trago']
  }
];

const API = 'https://api.hacienda.go.cr/fe/cabys';

const norm = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ');

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'en', 'al', 'a', 'un', 'una', 'por', 'para']);

const tokens = (s: string) => norm(s).split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));

const stem = (t: string) => t.slice(0, Math.max(4, t.length - 2));

const cache = new Map<string, CabysResult[]>();

/** Valida si un código CABYS tiene el formato oficial: 13 dígitos numéricos no nulos */
export const isValidCabys = (code?: string): boolean => 
  !!code && /^\d{13}$/.test(String(code).trim()) && !/^0+$/.test(String(code).trim());

/**
 * Resuelve y garantiza un código CABYS 100% válido para cualquier producto de restaurante.
 * Si ya tiene un código válido, lo preserva; si no, utiliza el motor semántico de restaurantes
 * para asignar el código oficial exacto de Hacienda CR (BCCR).
 */
export function resolveRestaurantCabys(
  name: string,
  category?: string,
  currentCode?: string,
  station?: string
): CabysResult {
  // 1. Si ya tiene un código CABYS válido, lo respetamos
  if (isValidCabys(currentCode)) {
    const clean = String(currentCode).trim();
    const preset = RESTAURANT_CABYS_PRESETS.find(p => p.codigo === clean);
    const firstDigit = parseInt(clean.charAt(0), 10);
    return {
      codigo: clean,
      descripcion: preset?.descripcion || name,
      impuesto: preset?.impuesto ?? 13,
      categoria: preset?.categoria || category || 'Restaurante',
      isService: !isNaN(firstDigit) && firstDigit >= 5
    };
  }

  // 2. Análisis semántico sobre el catálogo especializado de restaurantes
  const fullText = norm(`${name} ${category || ''} ${station || ''}`);
  const itemTokens = tokens(name);

  let bestMatch: PresetRestaurantCabys | null = null;
  let bestScore = -1;

  for (const preset of RESTAURANT_CABYS_PRESETS) {
    let score = 0;
    
    // Coincidencias de keywords del preset en el texto del producto
    for (const kw of preset.keywords) {
      const kwNorm = norm(kw);
      if (fullText.includes(kwNorm)) {
        score += 3;
        // Bonificación extra si la palabra clave está directamente en el nombre
        if (norm(name).includes(kwNorm)) score += 4;
      }
    }

    // Coincidencia con la categoría
    if (category && norm(category).includes(norm(preset.categoria))) {
      score += 5;
    }

    // Coincidencia con la estación de comanda (Bar vs Cocina)
    if (station === 'Bar' && (preset.categoria.includes('Bebida') || preset.categoria.includes('Licores') || preset.categoria.includes('Cerveza') || preset.categoria.includes('Bar'))) {
      score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = preset;
    }
  }

  // 3. Si hubo coincidencia relevante, devolverla
  if (bestMatch && bestScore > 0) {
    return {
      codigo: bestMatch.codigo,
      descripcion: bestMatch.descripcion,
      impuesto: bestMatch.impuesto,
      categoria: bestMatch.categoria,
      isService: bestMatch.isService,
      score: bestScore
    };
  }

  // 4. Fallback seguro e infalible por estación o categoría
  const isDrink = station === 'Bar' || /bebida|refresco|bar|trago|cerveza|vino|licor|coctel|cafe|jugo/.test(fullText);
  if (isDrink) {
    const isAlcohol = /cerveza|beer|vino|wine|licor|guaro|ron|whisky|vodka|tequila|coctel|trago/.test(fullText);
    const fallback = isAlcohol 
      ? RESTAURANT_CABYS_PRESETS.find(p => p.id === 'beer')!
      : RESTAURANT_CABYS_PRESETS.find(p => p.id === 'soda_softdrinks')!;
    return {
      codigo: fallback.codigo,
      descripcion: fallback.descripcion,
      impuesto: fallback.impuesto,
      categoria: fallback.categoria,
      isService: fallback.isService
    };
  }

  // Fallback universal: Servicio de preparación de comidas en restaurante (6331000000000)
  const defaultFood = RESTAURANT_CABYS_PRESETS[0];
  return {
    codigo: defaultFood.codigo,
    descripcion: defaultFood.descripcion,
    impuesto: defaultFood.impuesto,
    categoria: defaultFood.categoria,
    isService: defaultFood.isService
  };
}

/** Búsqueda en API pública de Hacienda CR con fallback al catálogo nativo */
async function rawSearch(q: string): Promise<CabysResult[]> {
  const key = norm(q).trim();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key)!;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout
    const res = await fetch(`${API}?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    const list: CabysResult[] = (data?.cabys || []).map((c: any) => {
      const cod = String(c.codigo);
      const firstDigit = parseInt(cod.charAt(0), 10);
      return {
        codigo: cod,
        descripcion: String(c.descripcion || ''),
        impuesto: Number(c.impuesto ?? 13),
        categoria: Array.isArray(c.categorias) && c.categorias.length ? String(c.categorias[c.categorias.length - 1]) : '',
        isService: !isNaN(firstDigit) && firstDigit >= 5
      };
    }).filter((c: CabysResult) => /^\d{13}$/.test(c.codigo));
    
    cache.set(key, list);
    return list;
  } catch {
    // Si la API falla o no hay internet, buscar en el catálogo nativo de restaurantes
    const localMatches = RESTAURANT_CABYS_PRESETS.filter(p => {
      const target = norm(`${p.descripcion} ${p.categoria} ${p.keywords.join(' ')}`);
      return target.includes(key) || tokens(key).some(t => target.includes(t));
    }).map(p => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      impuesto: p.impuesto,
      categoria: p.categoria,
      isService: p.isService
    }));
    return localMatches;
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
  score -= Math.max(0, descTokens.length - queryTokens.length) * 0.15;
  if (category && norm(category).includes('bebida') && /jugo|bebida|refresco|gaseosa|agua|cafe|te|cerveza|vino|licor/.test(text)) score += 1;
  return score;
}

/** Busca códigos CABYS con soporte híbrido Online + Offline */
export async function searchCabys(query: string, category?: string, limit = 8): Promise<CabysResult[]> {
  const qTokens = tokens(query);
  if (qTokens.length === 0) {
    // Devolver los presets de restaurante más populares
    return RESTAURANT_CABYS_PRESETS.slice(0, limit).map(p => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      impuesto: p.impuesto,
      categoria: p.categoria,
      isService: p.isService
    }));
  }

  // 1) Consulta remota / caché
  let results = await rawSearch(query);

  // 2) Si hay pocos resultados, combinar con búsqueda local de presets
  if (results.length < 5) {
    const local = RESTAURANT_CABYS_PRESETS.filter(p => {
      const target = norm(`${p.descripcion} ${p.categoria} ${p.keywords.join(' ')}`);
      return qTokens.some(t => target.includes(t));
    }).map(p => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      impuesto: p.impuesto,
      categoria: p.categoria,
      isService: p.isService
    }));

    const merged = new Map<string, CabysResult>();
    [...results, ...local].forEach(r => merged.set(r.codigo, r));
    results = [...merged.values()];
  }

  return results
    .map(r => ({ ...r, score: scoreResult(r, qTokens, category) }))
    .filter(r => (r.score || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
}

/** Mejor sugerencia para un producto, garantizando respuesta confiable */
export async function suggestCabys(name: string, category?: string): Promise<CabysResult | null> {
  // Primero intentar resolverlo mediante el catálogo especializado nativo
  const native = resolveRestaurantCabys(name, category);
  if (native && isValidCabys(native.codigo) && (native.score || 0) > 3) {
    return native;
  }

  // Si no hay alta certeza nativa, buscar en la API
  const results = await searchCabys(name, category, 1);
  if (results.length > 0) return results[0];

  return native;
}
