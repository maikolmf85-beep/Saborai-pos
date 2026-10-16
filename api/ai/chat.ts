import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

interface ChatRequestBody {
  userText: string;
  messages?: Array<{ sender: 'ai' | 'user'; text: string }>;
  context?: {
    menuItems?: Array<{ name: string; price: number; category?: string; available?: boolean }>;
    selectedTable?: { id?: string; name?: string; status?: string; seats?: number } | null;
    currentUser?: { name?: string; role?: string };
    restaurantName?: string;
    knowledgeContext?: string;
    systemInstruction?: string;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Utiliza POST.' });
  }

  // Optional JWT verification (permite modo demo sin bloquear)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    try {
      jwt.verify(token, jwtSecret);
    } catch {
      // Ignoramos error de expiración en demo para mantener disponibilidad
    }
  }

  const { userText, messages = [], context = {}, customApiKey } = (req.body || {}) as ChatRequestBody & { customApiKey?: string };

  if (!userText || typeof userText !== 'string' || !userText.trim()) {
    return res.status(400).json({ error: 'El campo userText es requerido.' });
  }

  const cleanUserText = userText.trim();
  const menuSummary = Array.isArray(context.menuItems) && context.menuItems.length > 0
    ? context.menuItems.map(m => `${m.name} (₡${m.price.toLocaleString()})`).join(', ')
    : 'Catálogo de menú vacío o no configurado.';

  const tableSummary = context.selectedTable
    ? `Mesa actual: ${context.selectedTable.name || 'Sin nombre'} (${context.selectedTable.status || 'AVAILABLE'})`
    : 'Sin mesa seleccionada.';

  const systemInstruction = context.systemInstruction || `Eres Saborai Copilot (desarrollado con Nyza AI), un asistente inteligente de punto de venta (POS) gastronómico para restaurantes de Costa Rica.
Tu misión es asistir ágilmente al personal (saloneros, cajeros, administradores y cocineros) en la toma de pedidos, cuadres de caja, sugerencias de maridaje, dudas de facturación electrónica Hacienda v4.4, escandallos y atajos operativos.

Reglas de respuesta:
1. Sé conciso, profesional, dinámico y amigable.
2. Si el usuario te pide una acción concreta del POS, incluye al final de tu respuesta un bloque de código JSON con la acción solicitada. Ejemplos de acciones soportadas:
- Agregar producto:
\`\`\`json
{"type": "ADD_ITEM", "product": "nombre_producto", "quantity": 1}
\`\`\`
- Crear mesa:
\`\`\`json
{"type": "ADD_TABLE", "name": "Mesa 2", "zone": "Principal"}
\`\`\`
- Abrir o gestionar turno:
\`\`\`json
{"type": "OPEN_SHIFT"}
\`\`\`

3. Marco legal y financiero de Costa Rica:
- Moneda principal: Colones costarricenses (₡) y USD opcional.
- Impuesto de Valor Agregado (IVA): 13% estándar (o exento según régimen simplificado).
- Servicio a la mesa: 10% obligatorio por Ley N° 4946 en consumos de salón.
- Facturación Electrónica v4.4 del Ministerio de Hacienda (clave 50 dígitos, consecutivos 20 dígitos).

Contexto del restaurante:
- Restaurante: ${context.restaurantName || 'Mi Restaurante'}
- Usuario en turno: ${context.currentUser?.name || 'Usuario'} (${context.currentUser?.role || 'ADMIN'})
- ${tableSummary}
- Menú disponible: ${menuSummary}
${context.knowledgeContext ? `\nConocimiento operacional de la sucursal:\n${context.knowledgeContext}` : ''}
`;

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
            // Extraer acción si existe
            let action = null;
            const match = rawText.match(/```json\n(\{.*?\})\n```/s);
            if (match && match[1]) {
              try { action = JSON.parse(match[1]); } catch {}
            }

            const cleanDisplay = rawText.replace(/```json\n\{.*?\}\n```/gs, '').trim();

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

  // 2. Motor Fallback: Anthropic Claude
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
            let action = null;
            const match = rawText.match(/```json\n(\{.*?\})\n```/s);
            if (match && match[1]) {
              try { action = JSON.parse(match[1]); } catch {}
            }

            const cleanDisplay = rawText.replace(/```json\n\{.*?\}\n```/gs, '').trim();

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

  // Respuesta de fallback inteligente local cuando no hay API keys externas configuradas en el servidor
  return res.status(200).json({
    success: true,
    response: `¡Hola! Soy Saborai Copilot. Estoy listo para ayudarte con la comanda de ${context.restaurantName || 'tu restaurante'}. Para activar la inteligencia predictiva completa con Google Gemini, configura tu variable GEMINI_API_KEY en Vercel. Mientras tanto, puedes usar todos los comandos rápidos del POS normalmente.`,
    provider: 'local-fallback'
  });
}
