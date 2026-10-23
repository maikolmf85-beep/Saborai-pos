import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { handleOptions, getJwtSecret, setCorsHeaders } from '../_utils/security.js';

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
      modifiers?: Array<{ name: string; choices?: string[] }>;
    }>;
    selectedTable?: { id?: string; name?: string; status?: string; seats?: number } | null;
    currentUser?: { name?: string; role?: string };
    zones?: string[];
    restaurantName?: string;
    knowledgeContext?: string;
    systemInstruction?: string;
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
      description: 'Crea una mesa disponible en un salón del mapa de mesas.',
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
      description: 'Navega a una sección del POS.',
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
      description: 'Abre el control de turno y caja para iniciar o gestionar el turno.',
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

function getIntent(text: string): 'support' | 'learning' | 'menu' | 'order' | 'reports' | 'layout' | 'general' {
  const normalized = text.toLocaleLowerCase('es-CR');
  if (/impres|hacienda|factur|base de datos|lento|error|falla|repar|soporte|caja|turno/.test(normalized)) return 'support';
  if (/aprend|mejor|iq|evoluc|heuristic|conocimiento/.test(normalized)) return 'learning';
  if (/reporte|ventas|ingres|ticket promedio|propina|estadistica|cierre/.test(normalized)) return 'reports';
  if (/salon|salón|mesa|terraza|patio|barra|zona|area|área/.test(normalized)) return 'layout';
  if (/comanda|pedido|platillo|producto|menu|menú|hamburgues|rib eye|carne|sin cebolla|pepinillo|termino|término/.test(normalized)) return 'order';
  if (/precio|carta|categoria|categoría|disponib|bebida|postre/.test(normalized)) return 'menu';
  return 'general';
}

function configuredSecret(...values: Array<string | undefined>): string {
  const value = values.find(item => typeof item === 'string' && item.trim().length > 0)?.trim() || '';
  return /^(tu_|your_|replace_|changeme)/i.test(value) ? '' : value;
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  // El modo demo puede usar el fallback local, pero cualquier JWT enviado debe ser válido.
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    }
  }

  const { userText, messages = [], context = {}, customApiKey } = (req.body || {}) as ChatRequestBody & { customApiKey?: string };

  if (!userText || typeof userText !== 'string' || !userText.trim()) {
    return res.status(400).json({ error: 'El campo userText es requerido.' });
  }

  const cleanUserText = userText.trim();
  const providerErrors: string[] = [];

  // Los saludos no requieren razonamiento ni una llamada de red. Esta ruta
  // evita que una conversación básica espere la latencia del proveedor de IA.
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
  const menuItems = Array.isArray(context.menuItems) ? context.menuItems : [];
  const needsMenu = ['menu', 'order', 'general'].includes(intent);
  const menuSummary = needsMenu && menuItems.length > 0
    ? menuItems.slice(0, 80).map(m => {
        const modifiers = m.modifiers?.length
          ? ` [opciones: ${m.modifiers.map(mod => `${mod.name}${mod.choices?.length ? `=${mod.choices.join('|')}` : ''}`).join('; ')}]`
          : '';
        return `${m.name} (₡${Number(m.price || 0).toLocaleString()}${m.available === false ? ', AGOTADO' : ''})${modifiers}`;
      }).join(', ')
    : '';
  const tableSummary = context.selectedTable
    ? `${context.selectedTable.name || 'Sin nombre'} (${context.selectedTable.status || 'AVAILABLE'})`
    : 'sin mesa seleccionada';
  const baseInstruction = `Eres Nyza, la inteligencia operativa de Saborai POS para restaurantes de Costa Rica.
Responde en español costarricense, con precisión y máximo 4 oraciones salvo que el usuario solicite un reporte detallado.
No inventes datos. Si falta información, dilo y pide solo el dato necesario.
Puedes sugerir modificaciones de comanda de forma contextual: para cortes como Rib Eye sugiere término de cocción; para hamburguesas considera sin cebolla, sin pepinillos, salsas y extras. Presenta sugerencias como opciones, nunca las agregues sin confirmación.
Cuando el usuario pida crear una mesa, cambiar de sección o abrir la caja, usa Function Calling con createTable, navigateTo u openCashRegister. No afirmes que la acción fue realizada hasta devolver la llamada de función.

Acciones POS disponibles; devuelve SOLO un bloque JSON al final cuando corresponda:
ADD_ITEM {product, quantity, modifiers:[{modifierName, choiceName, extraPrice}]}; ADD_TABLE {name, zone, seats}; ADD_ZONE {name}; ADD_TABLE_RANGE {zone, from, to, seats}; OPEN_REPORTS {range:"today"|"week"|"month"}; TOGGLE_DISH_AVAILABILITY {product, available}; OPEN_SHIFT; y tool_calls para diagnóstico autorizado.
Para solicitudes como "crea las mesas 11 a 20 en Terraza para 2 personas", usa una sola acción ADD_TABLE_RANGE con from=11, to=20, seats=2 y zone="Terraza". Nunca afirmes que una acción fue realizada si no incluyes el JSON correspondiente.
Para crear o mostrar un reporte usa OPEN_REPORTS; no inventes cifras que no estén en los datos del sistema.
El usuario actual es ${context.currentUser?.name || 'Empleado'} (${context.currentUser?.role || 'ADMIN'}). Mesa: ${tableSummary}.
Salones configurados: ${(context.zones || []).join(', ') || 'ninguno'}.
${needsMenu ? `Menú relevante:\n${menuSummary || 'catálogo vacío'}` : 'No es necesario enviar el menú para esta consulta.'}
${intent === 'learning' && context.knowledgeContext ? `\nConocimiento de aprendizaje:\n${context.knowledgeContext}` : ''}`;
  const systemInstruction = context.systemInstruction || baseInstruction;

  // Historial resumido de conversación
  const recentHistory = messages.slice(-6).map(m => `[${m.sender === 'user' ? 'Usuario' : 'Copilot'}]: ${m.text}`).join('\n');
  const fullPrompt = `${recentHistory ? `${recentHistory}\n` : ''}[Usuario]: ${cleanUserText}`;

  // 1. Motor Primario: Google Gemini
  const geminiKey = configuredSecret(
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_KEY,
    process.env.GEMINI_API_TOKEN,
    process.env.VITE_GEMINI_API_KEY,
    customApiKey && customApiKey.startsWith('AIza') ? customApiKey : undefined
  );
  if (geminiKey) {
    // 3.8 es el modelo principal; 3.5 Flash-Lite es un respaldo vigente,
    // multimodal y disponible en el nivel gratuito.
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
                parts: [{ text: `${systemInstruction}\n\n${fullPrompt}` }]
              }],
              config: { tools: nyzaUITools as any }
            });

            const rawText = response.text || '';
            const functionAction = functionCallToAction(response.functionCalls?.[0]);
            if (functionAction) {
              return res.status(200).json({
                success: true,
                response: rawText || 'Entendido. Voy a ejecutar esa acción en SaborAI POS.',
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
          } catch (mErr: any) {
            const message = String(mErr?.message || mErr);
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
    } catch (gErr: any) {
      providerErrors.push(`Gemini: ${String(gErr?.message || gErr).slice(0, 240)}`);
      console.warn('[API AI Chat] Error conectando a Gemini:', gErr?.message || gErr);
    }
  }

  // Nunca devolver un saludo genérico como si Nyza hubiera procesado la
  // consulta: eso ocultaba la causa real y hacía parecer funcional al chat.
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
