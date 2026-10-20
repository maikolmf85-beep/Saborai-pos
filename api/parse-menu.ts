import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Cargar variables de entorno en desarrollo local
try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

const PROMPT_TEXT =
  'Analiza este menú de restaurante. Extrae todas las categorías de productos, descripciones, precios y clasifícalos con su correspondiente código CABYS de Costa Rica (13 dígitos).';

const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    categorias: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nombre_categoria: { type: Type.STRING },
          productos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nombre: { type: Type.STRING },
                descripcion: { type: Type.STRING },
                precio: { type: Type.NUMBER },
                tipo_producto: {
                  type: Type.STRING,
                  description: "Opciones: 'comida', 'bebida_no_alcoholica', 'bebida_alcoholica'"
                },
                cabys: {
                  type: Type.STRING,
                  description: 'Código CABYS de 13 dígitos numéricos'
                }
              },
              required: ['nombre', 'precio', 'tipo_producto', 'cabys']
            }
          }
        },
        required: ['nombre_categoria', 'productos']
      }
    }
  },
  required: ['categorias']
};

function extractJsonFromText(rawText: string): any {
  const clean = rawText
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/im, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('La IA no devolvió un formato JSON válido.');
  }
}

async function parseWithGemini(
  apiKey: string,
  cleanBase64: string,
  resolvedMime: string
): Promise<{ data: any; model: string }> {
  const ai = new GoogleGenAI({ apiKey });
  // Mantener el analizador en modelos vigentes y gratuitos para proyectos nuevos.
  const candidateModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

  let lastError: any = null;

  for (let attempt = 0; attempt < candidateModels.length; attempt++) {
    const currentModel = candidateModels[attempt];
    try {
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: resolvedMime || 'image/jpeg'
            }
          },
          PROMPT_TEXT
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_SCHEMA
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      return { data: parsed, model: currentModel };
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err || '');
      console.warn(`Intento con modelo ${currentModel} falló:`, msg);

      const isHighDemandOrUnavailable = /high demand|overloaded|unavailable|resource_exhausted|503|429/i.test(msg);

      if (attempt < candidateModels.length - 1 && isHighDemandOrUnavailable) {
        // Pausa breve antes de cambiar al respaldo de Gemini.
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
  throw new Error('Gemini no pudo procesar la solicitud.');
}

/**
 * Función central de procesamiento de menú
 */
async function processMenuExtraction(params: {
  fileBase64?: string;
  mimeType?: string;
  geminiApiKey?: string;
  customKey?: string;
}) {
  const { fileBase64, mimeType, geminiApiKey, customKey } = params;

  if (!fileBase64) {
    throw new Error('No se envió ningún archivo');
  }

  const cleanBase64 = String(fileBase64)
    .replace(/^data:(image\/[a-zA-Z]+|application\/pdf);base64,/, '')
    .trim();

  if (!cleanBase64) {
    throw new Error('El contenido del archivo está vacío.');
  }

  let resolvedMime = mimeType ? String(mimeType).trim().toLowerCase() : 'image/jpeg';
  if (resolvedMime === 'application/octet-stream' || !resolvedMime) {
    resolvedMime = 'image/jpeg';
  }

  // En esta etapa Saborai usa exclusivamente Gemini, para evitar cargos y
  // fallbacks hacia proveedores de pago.
  let detectedGeminiKey = (
    geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY
  )?.trim();

  const genericCustomKey = (customKey || '').trim();
  if (!detectedGeminiKey && genericCustomKey && !genericCustomKey.startsWith('sk-')) {
    detectedGeminiKey = genericCustomKey;
  }

  if (detectedGeminiKey === 'tu_clave_aqui' || detectedGeminiKey === 'tu_api_key_aqui') {
    detectedGeminiKey = undefined;
  }

  if (!detectedGeminiKey) {
    throw new Error('API Key de Gemini no configurada. Configura GEMINI_API_KEY en las variables de entorno de Vercel.');
  }

  let menuData: any = null;
  let usedEngine = 'gemini-3.8-flash';
  const errors: string[] = [];

  try {
    const geminiRes = await parseWithGemini(detectedGeminiKey, cleanBase64, resolvedMime);
    menuData = geminiRes.data;
    usedEngine = geminiRes.model;
  } catch (geminiErr: any) {
    const gMsg = String(geminiErr?.message || geminiErr);
    console.warn('Gemini falló en /api/parse-menu:', gMsg);
    errors.push(`Gemini: ${gMsg}`);
  }

  if (menuData && Array.isArray(menuData.categorias)) {
    return {
      success: true,
      data: menuData,
      categorias: menuData.categorias,
      provider: usedEngine
    };
  }

  throw new Error(errors[0] || 'Error en la lectura del menú con IA.');
}

function formatAiError(error: any) {
  const rawMsg = String(error?.message || error || '');
  let isGoogleDenied = false;
  let isHighDemand = false;
  let userFriendly = rawMsg;

  if (
    rawMsg.includes('high demand') ||
    rawMsg.includes('overloaded') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('503') ||
    rawMsg.includes('429')
  ) {
    isHighDemand = true;
    userFriendly =
      'Los servidores de Gemini están experimentando alta demanda en este momento. Por favor espera unos segundos y vuelve a presionar "Analizar Carta con IA".';
  } else if (
    rawMsg.includes('Your project has been denied access') ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('"code":403') ||
    rawMsg.includes('code: 403')
  ) {
    isGoogleDenied = true;
    userFriendly =
      'Google Cloud denegó el acceso a este proyecto de Gemini. Crea una nueva clave en Google AI Studio y asígnala a un proyecto con Gemini API habilitada.';
  } else if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid')) {
    userFriendly = 'La API Key de IA no es válida o está vencida. Por favor ingresa una clave vigente de Gemini o Claude.';
  } else {
    try {
      const jsonStart = rawMsg.indexOf('{');
      if (jsonStart !== -1) {
        const parsed = JSON.parse(rawMsg.slice(jsonStart));
        if (parsed.error?.message) {
          userFriendly = parsed.error.message;
        }
      }
    } catch {}
  }

  return {
    error: isHighDemand
      ? 'Alta demanda en los servidores de Google Gemini'
      : isGoogleDenied
      ? 'Acceso denegado en Google Cloud (Proyecto Gemini)'
      : 'Error al procesar el menú con IA',
    details: userFriendly,
    isGoogleDenied,
    isHighDemand,
    rawError: rawMsg
  };
}

/**
 * Endpoint Web Standard: export async function POST(req: Request)
 */
export async function POST(req: Request) {
  try {
    const body = ((await req.json()) as any) || {};
    const result = await processMenuExtraction(body);
    return Response.json(result);
  } catch (error: any) {
    console.error('Error al procesar el menú con Gemini IA:', error);
    const formatted = formatAiError(error);
    return Response.json(formatted, { status: 500 });
  }
}

/**
 * Handler predeterminado para Vercel Serverless Functions (@vercel/node)
 */
export default async function handler(req: any, res?: any) {
  // Si se ejecuta en un runtime Web donde req es un Request estándar
  if (req instanceof Request || (!res && typeof req.json === 'function')) {
    return POST(req);
  }

  // CORS Headers para Vercel Serverless
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-gemini-api-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo se acepta POST.' });
  }

  try {
    const body = req.body || {};
    const headerGemini = (req.headers?.['x-gemini-api-key'] as string)?.trim();

    const result = await processMenuExtraction({
      ...body,
      geminiApiKey: headerGemini || body.geminiApiKey
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error al procesar el menú con Gemini IA:', error);
    const formatted = formatAiError(error);
    return res.status(500).json(formatted);
  }
}
