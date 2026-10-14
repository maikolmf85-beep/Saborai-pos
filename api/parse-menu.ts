import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
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
): Promise<any> {
  const ai = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const response = await ai.models.generateContent({
    model: modelName,
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

  return JSON.parse(response.text || '{}');
}

async function parseWithClaude(
  apiKey: string,
  cleanBase64: string,
  resolvedMime: string
): Promise<any> {
  const client = new Anthropic({ apiKey });
  const isPdf = resolvedMime === 'application/pdf';

  let mediaSource: any;
  if (isPdf) {
    mediaSource = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: cleanBase64
      }
    };
  } else {
    let imgMime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(resolvedMime)) {
      imgMime = resolvedMime as any;
    }
    mediaSource = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: imgMime,
        data: cleanBase64
      }
    };
  }

  const candidateModels = [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'claude-3-5-sonnet-20241022'
  ];

  const claudePrompt = `${PROMPT_TEXT}
IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura, sin texto explicativo ni formato markdown:
{
  "categorias": [
    {
      "nombre_categoria": "string",
      "productos": [
        {
          "nombre": "string",
          "descripcion": "string",
          "precio": 0,
          "tipo_producto": "comida",
          "cabys": "0000000000000"
        }
      ]
    }
  ]
}`;

  let lastErr: any = null;
  for (const model of candidateModels) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system:
          'Eres un analizador de menús de restaurante para sistemas POS. Tu única salida debe ser un objeto JSON estrictamente válido.',
        messages: [
          {
            role: 'user',
            content: [mediaSource, { type: 'text', text: claudePrompt }]
          }
        ]
      });

      const firstContent = response.content?.[0];
      if (firstContent && 'text' in firstContent) {
        return extractJsonFromText(firstContent.text);
      }
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (msg.includes('not_found') || msg.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error('Claude no devolvió contenido interpretable.');
}

/**
 * Función central de procesamiento de menú
 */
async function processMenuExtraction(params: {
  fileBase64?: string;
  mimeType?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  customKey?: string;
}) {
  const { fileBase64, mimeType, geminiApiKey, anthropicApiKey, customKey } = params;

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

  // Detección de API Keys
  let detectedGeminiKey = (
    geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY
  )?.trim();

  let detectedAnthropicKey = (
    anthropicApiKey ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.VITE_ANTHROPIC_API_KEY
  )?.trim();

  const genericCustomKey = (customKey || '').trim();
  if (genericCustomKey) {
    if (genericCustomKey.startsWith('sk-ant-')) {
      detectedAnthropicKey = genericCustomKey;
    } else {
      detectedGeminiKey = genericCustomKey;
    }
  }

  if (detectedGeminiKey === 'tu_clave_aqui' || detectedGeminiKey === 'tu_api_key_aqui') {
    detectedGeminiKey = undefined;
  }
  if (detectedAnthropicKey === 'tu_clave_aqui' || detectedAnthropicKey === 'tu_api_key_aqui') {
    detectedAnthropicKey = undefined;
  }

  const hasGemini = Boolean(detectedGeminiKey);
  const hasAnthropic = Boolean(detectedAnthropicKey);

  if (!hasGemini && !hasAnthropic) {
    throw new Error(
      'API Key no configurada. Configura GEMINI_API_KEY o ANTHROPIC_API_KEY en las variables de entorno de Vercel.'
    );
  }

  let menuData: any = null;
  let usedEngine = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const errors: string[] = [];

  // Intento principal: Gemini (usando GEMINI_MODEL o gemini-3.8-flash)
  if (hasGemini && detectedGeminiKey) {
    try {
      menuData = await parseWithGemini(detectedGeminiKey, cleanBase64, resolvedMime);
      usedEngine = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    } catch (geminiErr: any) {
      const gMsg = String(geminiErr?.message || geminiErr);
      console.warn('Gemini falló en /api/parse-menu:', gMsg);
      errors.push(`Gemini: ${gMsg}`);

      // Respaldo automático con Claude Vision si está disponible
      if (hasAnthropic && detectedAnthropicKey) {
        console.log('Iniciando respaldo automático con Claude Vision...');
        try {
          menuData = await parseWithClaude(detectedAnthropicKey, cleanBase64, resolvedMime);
          usedEngine = 'Claude 4.5 Vision (Respaldo)';
        } catch (claudeErr: any) {
          const cMsg = String(claudeErr?.message || claudeErr);
          errors.push(`Claude: ${cMsg}`);
        }
      }
    }
  } else if (hasAnthropic && detectedAnthropicKey) {
    // Si solo hay Claude configurado
    try {
      menuData = await parseWithClaude(detectedAnthropicKey, cleanBase64, resolvedMime);
      usedEngine = 'Claude 4.5 Vision';
    } catch (claudeErr: any) {
      const cMsg = String(claudeErr?.message || claudeErr);
      errors.push(`Claude: ${cMsg}`);
    }
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
    return Response.json(
      { error: `Error en la lectura del menú: ${error.message || error}` },
      { status: 500 }
    );
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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-gemini-api-key, x-anthropic-api-key, x-ai-provider'
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
    const headerAnthropic = (req.headers?.['x-anthropic-api-key'] as string)?.trim();

    const result = await processMenuExtraction({
      ...body,
      geminiApiKey: headerGemini || body.geminiApiKey,
      anthropicApiKey: headerAnthropic || body.anthropicApiKey
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error al procesar el menú con Gemini IA:', error);
    return res.status(500).json({
      error: `Error en la lectura del menú: ${error.message || error}`,
      details: error.message || String(error)
    });
  }
}
