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
): Promise<{ data: any; model: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const preferredModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const candidateModels = [
    preferredModel,
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-flash-latest'
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

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

      const isHighDemandOrUnavailable =
        msg.includes('high demand') ||
        msg.includes('overloaded') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.includes('not found') ||
        msg.includes('no longer available');

      if (attempt < candidateModels.length - 1 && isHighDemandOrUnavailable) {
        // Pausa breve de 1s antes de intentar con el siguiente modelo de Gemini
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
  throw new Error('Gemini no pudo procesar la solicitud.');
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

async function parseWithOpenAICompatible(
  apiKey: string,
  cleanBase64: string,
  resolvedMime: string
): Promise<{ data: any; model: string }> {
  const baseUrl = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MENU_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const dataUri = `data:${resolvedMime};base64,${cleanBase64}`;
  const isPdf = resolvedMime === 'application/pdf';

  // Chat Completions soporta image_url de forma amplia. El bloque file es
  // compatible con gateways que aceptan archivos inline; si el gateway no lo
  // implementa, el flujo continúa con Gemini/Claude cuando estén configurados.
  const mediaPart = isPdf
    ? {
        type: 'file',
        file: { filename: 'menu.pdf', file_data: dataUri }
      }
    : {
        type: 'image_url',
        image_url: { url: dataUri, detail: 'high' }
      };

  const extractionPrompt = `${PROMPT_TEXT}
Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional, usando exactamente esta estructura:
{
  "categorias": [
    {
      "nombre_categoria": "string",
      "productos": [
        {
          "nombre": "string",
          "descripcion": "string",
          "precio": 0,
          "tipo_producto": "comida | bebida_no_alcoholica | bebida_alcoholica",
          "cabys": "0000000000000"
        }
      ]
    }
  ]
}
Conserva los precios tal como aparecen en la carta. Si un precio no es legible, usa 0 y no inventes uno. Solo incluye productos realmente visibles en el documento.`;

  const requestBody: any = {
    model,
    temperature: 0.1,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: extractionPrompt },
        mediaPart
      ]
    }],
    response_format: { type: 'json_object' }
  };

  const call = async (body: any) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenAI-compatible: ${message}`);
    }
    const rawText = typeof payload?.choices?.[0]?.message?.content === 'string'
      ? payload.choices[0].message.content
      : '';
    if (!rawText) throw new Error('OpenAI-compatible no devolvió contenido.');
    return extractJsonFromText(rawText);
  };

  try {
    return { data: await call(requestBody), model };
  } catch (err: any) {
    // Algunos gateways compatibles no implementan response_format; reintentar
    // sin esa opción conserva compatibilidad sin duplicar el procesamiento.
    const message = String(err?.message || err);
    if (message.includes('response_format') || message.includes('json_object') || message.includes('unsupported')) {
      const { response_format: _ignored, ...withoutFormat } = requestBody;
      return { data: await call(withoutFormat), model };
    }
    throw err;
  }
}

/**
 * Función central de procesamiento de menú
 */
async function processMenuExtraction(params: {
  fileBase64?: string;
  mimeType?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openAiApiKey?: string;
  customKey?: string;
}) {
  const { fileBase64, mimeType, geminiApiKey, anthropicApiKey, openAiApiKey, customKey } = params;

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

  let detectedOpenAiKey = (
    openAiApiKey || process.env.OPENAI_API_KEY
  )?.trim();

  const genericCustomKey = (customKey || '').trim();
  if (genericCustomKey) {
    if (genericCustomKey.startsWith('sk-ant-')) {
      detectedAnthropicKey = genericCustomKey;
    } else if (genericCustomKey.startsWith('sk-')) {
      detectedOpenAiKey = genericCustomKey;
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
  if (detectedOpenAiKey === 'tu_openai_api_key' || detectedOpenAiKey === 'tu_api_key_aqui') {
    detectedOpenAiKey = undefined;
  }

  const hasGemini = Boolean(detectedGeminiKey);
  const hasAnthropic = Boolean(detectedAnthropicKey);
  const hasOpenAi = Boolean(detectedOpenAiKey);

  if (!hasGemini && !hasAnthropic && !hasOpenAi) {
    throw new Error(
      'API Key no configurada. Configura GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY en las variables de entorno de Vercel.'
    );
  }

  let menuData: any = null;
  let usedEngine = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const errors: string[] = [];

  // Intento principal: Gemini (usando GEMINI_MODEL o gemini-3.8-flash y candidatos de respaldo)
  if (hasGemini && detectedGeminiKey) {
    try {
      const geminiRes = await parseWithGemini(detectedGeminiKey, cleanBase64, resolvedMime);
      menuData = geminiRes.data;
      usedEngine = geminiRes.model;
    } catch (geminiErr: any) {
      const gMsg = String(geminiErr?.message || geminiErr);
      console.warn('Gemini falló en /api/parse-menu:', gMsg);
      errors.push(`Gemini: ${gMsg}`);

      // Respaldo automático con OpenAI-compatible o Claude Vision.
      if (hasOpenAi && detectedOpenAiKey) {
        console.log('Iniciando respaldo automático con OpenAI-compatible Vision...');
        try {
          const openAiRes = await parseWithOpenAICompatible(detectedOpenAiKey, cleanBase64, resolvedMime);
          menuData = openAiRes.data;
          usedEngine = `OpenAI-compatible (${openAiRes.model})`;
        } catch (openAiErr: any) {
          errors.push(`OpenAI-compatible: ${String(openAiErr?.message || openAiErr)}`);
        }
      }
      if (!menuData && hasAnthropic && detectedAnthropicKey) {
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
  } else if (hasOpenAi && detectedOpenAiKey) {
    try {
      const openAiRes = await parseWithOpenAICompatible(detectedOpenAiKey, cleanBase64, resolvedMime);
      menuData = openAiRes.data;
      usedEngine = `OpenAI-compatible (${openAiRes.model})`;
    } catch (openAiErr: any) {
      const oMsg = String(openAiErr?.message || openAiErr);
      console.warn('OpenAI-compatible falló en /api/parse-menu:', oMsg);
      errors.push(`OpenAI-compatible: ${oMsg}`);
      if (hasAnthropic && detectedAnthropicKey) {
        console.log('Iniciando respaldo automático con Claude Vision...');
        try {
          menuData = await parseWithClaude(detectedAnthropicKey, cleanBase64, resolvedMime);
          usedEngine = 'Claude 4.5 Vision (Respaldo)';
        } catch (claudeErr: any) {
          errors.push(`Claude: ${String(claudeErr?.message || claudeErr)}`);
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
      'Google Cloud denegó el acceso a este proyecto de Gemini. Para solucionarlo: Crea una nueva clave en Google AI Studio (aistudio.google.com/apikey) eligiendo "Create in new project" (Nuevo Proyecto), o configura tu clave de Claude (Anthropic).';
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
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-gemini-api-key, x-anthropic-api-key, x-openai-api-key, x-ai-provider'
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
    const headerOpenAi = (req.headers?.['x-openai-api-key'] as string)?.trim();

    const result = await processMenuExtraction({
      ...body,
      geminiApiKey: headerGemini || body.geminiApiKey,
      anthropicApiKey: headerAnthropic || body.anthropicApiKey,
      openAiApiKey: headerOpenAi || body.openAiApiKey
    });

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Error al procesar el menú con Gemini IA:', error);
    const formatted = formatAiError(error);
    return res.status(500).json(formatted);
  }
}
