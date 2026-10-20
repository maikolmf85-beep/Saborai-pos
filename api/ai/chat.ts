import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
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
  const geminiKey = (customApiKey && customApiKey.startsWith('AIza'))
    ? customApiKey
    : (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || (customApiKey && !customApiKey.startsWith('sk-ant') ? customApiKey : ''));
  if (geminiKey && geminiKey !== 'tu_gemini_api_key' && geminiKey !== 'tu_api_key_aqui') {
    const geminiModels = [
      process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-1.5-flash'
    ];

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      for (const modelName of geminiModels) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `${systemInstruction}\n\n${fullPrompt}` }
                ]
              }
            ]
          });

          const rawText = response.text || '';
          if (rawText) {
            const parsed = parseAction(rawText);
            const action = parsed.action;
            const cleanDisplay = parsed.display;

            return res.status(200).json({
              success: true,
              response: cleanDisplay || rawText,
              rawResponse: rawText,
              action,
              provider: 'gemini',
              model: modelName
            });
          }
        } catch (mErr: any) {
          console.warn(`[API AI Chat] Modelo ${modelName} no disponible:`, mErr?.message || mErr);
        }
      }
    } catch (gErr: any) {
      console.warn('[API AI Chat] Error conectando a Gemini:', gErr?.message || gErr);
    }
  }

  // 2. Motor OpenAI-compatible del lado servidor. La clave nunca se envía
  // desde el navegador; también permite usar gateways compatibles.
  const openAiKey = process.env.OPENAI_API_KEY || '';
  const openAiBase = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (openAiKey && openAiKey !== 'tu_openai_api_key') {
    try {
      const openAiRes = await fetch(`${openAiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.25,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: systemInstruction },
            ...messages.slice(-6).map(message => ({
              role: message.sender === 'user' ? 'user' : 'assistant',
              content: message.text
            })),
            { role: 'user', content: cleanUserText }
          ]
        })
      });
      const openAiData: any = await openAiRes.json().catch(() => ({}));
      if (openAiRes.ok) {
        const rawText = extractAssistantText(openAiData?.choices?.[0]?.message?.content);
        if (rawText) {
          const parsed = parseAction(rawText);
          return res.status(200).json({
            success: true,
            response: parsed.display,
            rawResponse: rawText,
            action: parsed.action,
            provider: 'openai-compatible',
            model: openAiModel
          });
        }
      } else {
        console.warn('[API AI Chat] OpenAI-compatible rechazó la solicitud:', openAiData?.error?.message || openAiRes.status);
      }
    } catch (openAiErr: any) {
      console.warn('[API AI Chat] Error conectando al proveedor OpenAI-compatible:', openAiErr?.message || openAiErr);
    }
  }

  // 3. Motor Fallback: Anthropic Claude
  const anthropicKey = (customApiKey && customApiKey.startsWith('sk-ant'))
    ? customApiKey
    : (process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '');
  if (anthropicKey && anthropicKey !== 'tu_api_key_aqui') {
    const claudeModels = [
      'claude-haiku-4-5-20251001',
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307'
    ];

    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      for (const modelName of claudeModels) {
        try {
          const msg = await anthropic.messages.create({
            model: modelName,
            max_tokens: 1024,
            system: systemInstruction,
            messages: [{ role: 'user', content: fullPrompt }]
          });

          const firstBlock = msg.content[0];
          const rawText = firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';
          if (rawText) {
            const parsed = parseAction(rawText);
            const action = parsed.action;
            const cleanDisplay = parsed.display;

            return res.status(200).json({
              success: true,
              response: cleanDisplay || rawText,
              rawResponse: rawText,
              action,
              provider: 'anthropic',
              model: modelName
            });
          }
        } catch (cErr: any) {
          console.warn(`[API AI Chat] Falló Claude modelo ${modelName}:`, cErr?.message || cErr);
        }
      }
    } catch (aErr: any) {
      console.warn('[API AI Chat] Error conectando a Anthropic:', aErr?.message || aErr);
    }
  }

  // Nunca devolver un saludo genérico como si Nyza hubiera procesado la
  // consulta: eso ocultaba la causa real y hacía parecer funcional al chat.
  return res.status(503).json({
    error: 'Nyza no tiene un motor de IA configurado en el servidor. Configura GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY en el entorno de producción.'
  });
}
