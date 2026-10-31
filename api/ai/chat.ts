import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { authenticateRequest, handleOptions, setCorsHeaders } from '../_utils/security.js';

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

interface ChatRequestBody {
  userText: string;
  messages?: Array<{ sender: 'ai' | 'user'; text: string }>;
  context?: {
    menuItems?: Array<{
      name: string;
      price: number;
      category?: string;
      available?: boolean;
      modifiers?: Array<{ name: string; choices?: Array<{ name: string; extraPrice?: number }> }>;
      ingredients?: Array<{ name: string; currentStock: number; requiredQty: number; unit: string }>;
    }>;
    menuItemCount?: number;
    selectedTable?: { id?: string; name?: string; status?: string; seats?: number } | null;
    zones?: string[];
    localLearningSummary?: string;
  };
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part: any) => typeof part === 'string' ? part : part?.text || '').join('').trim();
  }
  return '';
}

function parseAction(rawText: string): { action: any | null; display: string } {
  const match = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
  let action = null;
  if (match?.[1]) {
    try { action = JSON.parse(match[1]); } catch {}
  }
  return {
    action,
    display: rawText.replace(/```json\s*[\s\S]*?\s*```/gi, '').trim() || rawText
  };
}

const nyzaUITools = [{
  functionDeclarations: [
    {
      name: 'createTable',
      description: 'Propone crear una mesa en un salón ya configurado. La interfaz pedirá confirmación.',
      parameters: {
        type: 'OBJECT',
        properties: {
          salonName: { type: 'STRING', description: 'Nombre exacto del salón o zona.' },
          tableNumber: { type: 'NUMBER', description: 'Número de la mesa que se desea crear.' }
        },
        required: ['salonName', 'tableNumber']
      }
    },
    {
      name: 'navigateTo',
      description: 'Propone abrir una sección del POS; la interfaz pedirá confirmación.',
      parameters: {
        type: 'OBJECT',
        properties: {
          view: { type: 'STRING', enum: ['tables', 'billing', 'kds', 'menu'], description: 'Sección destino.' }
        },
        required: ['view']
      }
    },
    {
      name: 'openCashRegister',
      description: 'Propone abrir el control de turno y caja; la interfaz pedirá confirmación.',
      parameters: { type: 'OBJECT', properties: {} }
    }
  ]
}];

function functionCallToAction(call: any): any | null {
  const name = call?.name;
  const args = call?.args || call?.arguments || {};
  if (name === 'createTable') return { type: 'CREATE_TABLE', params: args };
  if (name === 'navigateTo') return { type: 'NAVIGATE_TO', params: args };
  if (name === 'openCashRegister') return { type: 'OPEN_CASH_REGISTER', params: {} };
  return null;
}

function isSimpleGreeting(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase('es-CR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!¡?¿.,;:]+/g, ' ')
    .trim();
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|pura vida|hey|hi|hello)(\s+(nyza|nysa))?$/.test(normalized);
}

type Intent = 'support' | 'learning' | 'menu' | 'order' | 'stock' | 'reports' | 'layout' | 'general';

function getIntent(text: string): Intent {
  const normalized = text.toLocaleLowerCase('es-CR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/regla|nota local|aprend|iq|evoluc|heuristic|conocimiento/.test(normalized)) return 'learning';
  if (/impres|hacienda|factur|base de datos|lento|error|falla|repar|soporte|caja|turno/.test(normalized)) return 'support';
  if (/mejor/.test(normalized)) return 'learning';
  if (/stock|inventar|insumo|existencia|agotad|bajo|critico/.test(normalized)) return 'stock';
  if (/reporte|ventas|vendimos|venta|ingres|ticket promedio|propina|estadistica|cierre/.test(normalized)) return 'reports';
  if (/salon|mesa|terraza|patio|barra|zona|area/.test(normalized)) return 'layout';
  if (/comanda|pedido|platillo|producto|menu|hamburgues|rib eye|carne|sin cebolla|pepinillo|termino/.test(normalized)) return 'order';
  if (/precio|carta|categoria|disponib|bebida|postre/.test(normalized)) return 'menu';
  return 'general';
}

function configuredSecret(...values: Array<string | undefined>): string {
  const value = values.find(item => typeof item === 'string' && item.trim().length > 0)?.trim() || '';
  return /^(tu_|your_|replace_|changeme)/i.test(value) ? '' : value;
}

function buildStockResponse(menuItems: NonNullable<ChatRequestBody['context']>['menuItems'], totalItemCount?: number): string {
  if (!menuItems?.length) {
    return 'No puedo consultar existencias: esta consulta no incluye el menú local de esta sesión.';
  }

  const inspected = menuItems.slice(0, 500);
  const lowStock: string[] = [];
  let recipesWithStock = 0;
  for (const item of inspected) {
    if (!Array.isArray(item.ingredients) || item.ingredients.length === 0) continue;
    const validIngredients = item.ingredients.filter(ingredient =>
      typeof ingredient.name === 'string'
      && typeof ingredient.unit === 'string'
      && Number.isFinite(ingredient.currentStock)
      && ingredient.currentStock >= 0
      && Number.isFinite(ingredient.requiredQty)
      && ingredient.requiredQty > 0
    );
    if (validIngredients.length === 0) continue;
    recipesWithStock += 1;
    const bottleneck = validIngredients.reduce((lowest, current) =>
      Math.floor(current.currentStock / current.requiredQty) < Math.floor(lowest.currentStock / lowest.requiredQty)
        ? current
        : lowest
    );
    const portions = Math.floor(bottleneck.currentStock / bottleneck.requiredQty);
    if (portions <= 3 || item.available === false) {
      const stockLabel = portions <= 3
        ? `${bottleneck.name}: ${bottleneck.currentStock} ${bottleneck.unit}; alcanza para aproximadamente ${portions} porción(es)`
        : 'marcado como no disponible en el menú';
      lowStock.push(`- ${item.name}: ${stockLabel}.`);
    }
  }

  const total = Number.isInteger(totalItemCount) && Number(totalItemCount) >= inspected.length ? Number(totalItemCount) : menuItems.length;
  const coverage = total > inspected.length
    ? ` Revisé ${inspected.length} de ${total} productos del menú; quedan ${total - inspected.length} fuera de esta revisión.`
    : ` Revisé ${inspected.length} producto(s) recibidos.`;
  if (recipesWithStock === 0) {
    return `No hay fichas de receta con cantidades de existencias válidas en los productos revisados; no puedo determinar qué insumos están bajos.${coverage}`;
  }
  if (lowStock.length === 0) {
    return `Según las fichas de receta y existencias locales de esta sesión, no encontré platillos agotados ni con 3 o menos porciones estimadas.${coverage} No es una verificación remota.`;
  }
  return `Según el inventario local de esta sesión, estos platillos están agotados, marcados como no disponibles o tienen hasta 3 porciones estimadas:\n${lowStock.slice(0, 20).join('\n')}${coverage} La estimación usa la receta configurada y no es una verificación remota.`;
}

function buildLearningResponse(summary?: string): string {
  const localSummary = typeof summary === 'string' ? summary.trim().slice(0, 5000) : '';
  return localSummary || 'Nyza no entrena el modelo ni sincroniza aprendizaje global en esta versión. No hay un IQ operativo verificable; puedes guardar reglas locales creadas por el equipo.';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  // El modo demo puede usar respuestas locales, pero cualquier JWT enviado debe ser válido.
  const authHeader = req.headers.authorization;
  let authenticatedUser: Awaited<ReturnType<typeof authenticateRequest>> = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      authenticatedUser = await authenticateRequest(req);
      if (!authenticatedUser) throw new Error('invalid-session');
    } catch {
      return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    }
  }

  const body = (req.body || {}) as ChatRequestBody;
  const { userText } = body;
  const context = body.context || {};
  const messages = Array.isArray(body.messages)
    ? body.messages.filter(message => message && (message.sender === 'ai' || message.sender === 'user') && typeof message.text === 'string').slice(-6)
    : [];

  if (!userText || typeof userText !== 'string' || !userText.trim()) {
    return res.status(400).json({ error: 'El campo userText es requerido.' });
  }

  const cleanUserText = userText.trim();
  const providerErrors: string[] = [];

  if (isSimpleGreeting(cleanUserText)) {
    return res.status(200).json({
      success: true,
      response: '¡Pura vida! Soy Nyza. ¿En qué puedo ayudarte?',
      rawResponse: '¡Pura vida! Soy Nyza. ¿En qué puedo ayudarte?',
      action: null,
      provider: 'local-fast-path'
    });
  }

  const intent = getIntent(cleanUserText);
  if (intent === 'learning') {
    const response = buildLearningResponse(context.localLearningSummary);
    return res.status(200).json({ success: true, response, rawResponse: response, action: null, provider: 'local-learning-summary' });
  }
  if (intent === 'stock') {
    const menuItems = Array.isArray(context.menuItems) ? context.menuItems.filter(item => item && typeof item.name === 'string') : [];
    const response = buildStockResponse(menuItems, context.menuItemCount);
    return res.status(200).json({ success: true, response, rawResponse: response, action: null, provider: 'local-inventory-snapshot' });
  }
  if (intent === 'reports') {
    const asksToOpen = /\b(abrir|abre|abrime|mostrar|muestra|ver|ir a)\b/.test(cleanUserText.toLocaleLowerCase('es-CR'));
    const range = /\b(mes|mensual)\b/i.test(cleanUserText)
      ? 'month'
      : /\b(semana|semanal)\b/i.test(cleanUserText) ? 'week' : 'today';
    const response = asksToOpen
      ? 'No tengo acceso a las cifras numéricas del módulo. Puedo abrir la sección de reportes para que revises los datos actuales.'
      : 'No tengo acceso a las cifras numéricas de ventas o cierres en esta conversación. Puedes pedir que abra la sección de reportes para consultarlas.';
    return res.status(200).json({
      success: true,
      response,
      rawResponse: response,
      action: asksToOpen ? { type: 'OPEN_REPORTS', range } : null,
      provider: 'local-report-limitation'
    });
  }
  const normalizedSupportText = cleanUserText.toLocaleLowerCase('es-CR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (intent === 'support' && /ram|memoria|auto.?repar|repara.*sistema|impres|spooler/.test(normalizedSupportText)) {
    const response = 'No puedo confirmar conectividad ni reiniciar el servicio de impresión o liberar RAM desde esta conversación. No he ejecutado una reparación. Puedo ayudarte con una lista de comprobaciones manuales; evita borrar cachés o datos pendientes.';
    return res.status(200).json({ success: true, response, rawResponse: response, action: null, provider: 'local-capability-limit' });
  }
  if (intent === 'support' && /hacienda|\bdgt\b|factur/.test(normalizedSupportText)) {
    const response = 'No tengo el estado de Hacienda ni los datos de tus comprobantes en esta conversación. No he enviado ni reenviado facturas; revisa el módulo de facturación y confirma cada envío allí.';
    return res.status(200).json({ success: true, response, rawResponse: response, action: null, provider: 'local-capability-limit' });
  }

  const menuItems = Array.isArray(context.menuItems)
    ? context.menuItems.filter(item => item && typeof item.name === 'string').slice(0, 500)
    : [];
  const needsMenu = ['menu', 'order'].includes(intent);
  const menuSummary = needsMenu && menuItems.length > 0
    ? menuItems.slice(0, 80).map(item => {
        const modifiers = item.modifiers?.length
          ? ` [opciones: ${item.modifiers.map(modifier => `${modifier.name}${modifier.choices?.length ? `=${modifier.choices.map(choice => `${choice.name}${Number.isFinite(choice.extraPrice) && choice.extraPrice ? ` (+₡${choice.extraPrice})` : ''}`).join('|')}` : ''}`).join('; ')}]`
          : '';
        return `${item.name} (₡${Number(item.price || 0).toLocaleString()}${item.available === false ? ', AGOTADO' : ''})${modifiers}`;
      }).join(', ')
    : '';
  const tableSummary = context.selectedTable
    ? `${context.selectedTable.name || 'Sin nombre'} (${context.selectedTable.status || 'AVAILABLE'})`
    : 'sin mesa seleccionada';
  const zoneList = Array.isArray(context.zones)
    ? context.zones.filter(zone => typeof zone === 'string').slice(0, 50)
    : [];
  const authenticatedUserSummary = authenticatedUser
    ? `sesión autenticada (${authenticatedUser.role || 'USER'})`
    : 'modo demostración sin sesión autenticada';
  const baseInstruction = `Eres Nyza, el asistente de SaborAI POS para restaurantes de Costa Rica.
Responde en español costarricense, con precisión y máximo 4 oraciones salvo que el usuario solicite un reporte detallado.
No inventes datos. Si falta información, dilo y pide solo el dato necesario.
Puedes sugerir modificaciones de comanda de forma contextual, pero siempre como opciones. Ninguna acción se ejecuta hasta que el usuario revise una vista previa y la confirme explícitamente en la interfaz.
Si una acción se propone, nunca afirmes que ya se realizó ni uses lenguaje de resultado completado. No afirmes haber consultado el estado actual de una impresora, una base de datos o Hacienda, ni haber reparado el sistema, si no hay un resultado verificado de una herramienta.
Para consultas de ventas/reportes no recibes cifras numéricas; no inventes ni estimes resultados.
Cuando el usuario pida crear una mesa, cambiar de sección o abrir la caja, usa Function Calling con createTable, navigateTo u openCashRegister para proponer una acción, no para afirmar que fue realizada.
Acciones POS que puedes proponer en JSON cuando corresponda: ADD_ITEM {product, quantity, modifiers:[{modifierName, choiceName}]}; ADD_TABLE {name, zone, seats}; ADD_ZONE {name}; ADD_TABLE_RANGE {zone, from, to, seats}; OPEN_REPORTS {range:"today"|"week"|"month"}; TOGGLE_DISH_AVAILABILITY {product, available}; OPEN_SHIFT; y tool_calls de diagnóstico.
Para crear mesas, usa solo salones configurados. No inventes cifras de inventario, ventas, aprendizaje, métricas globales, IQ ni resultados de reparación.
El usuario tiene ${authenticatedUserSummary}. Mesa seleccionada: ${tableSummary}.
Salones configurados: ${zoneList.join(', ') || 'ninguno'}.
${needsMenu ? `Menú relevante:\n${menuSummary || 'catálogo vacío'}` : 'No se envía el menú para esta consulta.'}`;

  const recentHistory = messages.map(message => `[${message.sender === 'user' ? 'Usuario' : 'Copilot'}]: ${message.text}`).join('\n');
  const fullPrompt = `${recentHistory ? `${recentHistory}\n` : ''}[Usuario]: ${cleanUserText}`;

  const geminiKey = authenticatedUser ? configuredSecret(
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_KEY,
    process.env.GEMINI_API_TOKEN
  ) : '';
  if (geminiKey) {
    const geminiModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      for (const modelName of geminiModels) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: [{
                role: 'user',
                parts: [{ text: `${baseInstruction}\n\n${fullPrompt}` }]
              }],
              config: { tools: nyzaUITools as any }
            });

            const rawText = extractAssistantText(response.text || '');
            const functionAction = functionCallToAction(response.functionCalls?.[0]);
            if (functionAction) {
              return res.status(200).json({
                success: true,
                response: rawText || 'Puedo proponer esa acción para que la revises.',
                rawResponse: rawText,
                action: functionAction,
                provider: 'gemini-function-calling',
                model: modelName
              });
            }
            if (rawText) {
              const parsed = parseAction(rawText);
              return res.status(200).json({
                success: true,
                response: parsed.display || rawText,
                rawResponse: rawText,
                action: parsed.action,
                provider: 'gemini',
                model: modelName
              });
            }
          } catch (modelError: any) {
            const message = String(modelError?.message || modelError);
            const transient = /503|429|unavailable|high demand|resource_exhausted|overloaded/i.test(message);
            if (transient && attempt === 0) {
              await new Promise(resolve => setTimeout(resolve, 900));
              continue;
            }
            providerErrors.push(`Gemini ${modelName}: ${message.slice(0, 240)}`);
            console.warn(`[API AI Chat] Modelo ${modelName} no disponible:`, message);
          }
        }
      }
    } catch (providerError: any) {
      providerErrors.push(`Gemini: ${String(providerError?.message || providerError).slice(0, 240)}`);
      console.warn('[API AI Chat] Error conectando a Gemini:', providerError?.message || providerError);
    }
  }

  if (providerErrors.length > 0) {
    const detail = Array.from(new Set(providerErrors)).slice(-2).join(' | ');
    return res.status(502).json({
      error: `Nyza encontró las variables de IA, pero el proveedor rechazó o no pudo procesar la solicitud. ${detail}`,
      details: detail
    });
  }

  return res.status(503).json({
    error: 'Nyza no tiene Gemini configurado. Configura GEMINI_API_KEY en el entorno de producción.'
  });
}
