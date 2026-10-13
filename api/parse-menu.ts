import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Cargar variables de entorno en desarrollo local
try {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
} catch {}

const PROMPT_TEXT = `
Eres un asistente experto en digitalización de cartas y menús de restaurantes para sistemas POS gastronómicos.
Analiza detenidamente la carta o menú provisto (imagen o archivo PDF).
Extrae todos los productos y platos organizados por sus categorías correspondientes (por ejemplo: Entradas, Platos Fuertes, Pastas, Carnes, Bebidas, Cocteles, Postres, etc.).

Reglas de extracción:
1. Agrupa los productos en categorías lógicas tal como aparecen en el menú. Si no hay categorías explícitas, deduce categorías estándar representativas (ej. "Entradas", "Platos Fuertes", "Bebidas", "Postres").
2. Para cada producto:
   - "nombre": Nombre exacto y claro del plato o bebida.
   - "descripcion": Breve descripción de ingredientes o preparación si aparece en la carta (o cadena vacía si no hay).
   - "precio": Precio numérico sin símbolos de moneda (ej: si dice ₡5.500 o ₡5500, extrae 5500; si dice $12.50, extrae 12.5). Si no tiene precio visible, asigna 0.
3. Si los precios incluyen comas o puntos de miles/decimales, conviértelos adecuadamente a un tipo number de JavaScript.
4. Asegúrate de no omitir ningún plato o bebida visible en el documento.

IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura, sin texto introductorio, sin conclusiones y sin bloques de markdown:
{
  "categorias": [
    {
      "nombre_categoria": "Nombre de la categoría",
      "productos": [
        {
          "nombre": "Nombre del plato o producto",
          "descripcion": "Descripción breve o vacía",
          "precio": 5000
        }
      ]
    }
  ]
}
`;

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

  let lastErr: any = null;
  for (const model of candidateModels) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system:
          'Eres un analizador de menús de restaurante para sistemas POS. Tu única salida debe ser un objeto JSON estrictamente válido según las especificaciones del usuario.',
        messages: [
          {
            role: 'user',
            content: [mediaSource, { type: 'text', text: PROMPT_TEXT }]
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

async function parseWithGemini(
  apiKey: string,
  cleanBase64: string,
  resolvedMime: string
): Promise<any> {
  const ai = new GoogleGenAI({ apiKey });
  const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];

  let lastError: any = null;
  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: resolvedMime,
                  data: cleanBase64
                }
              },
              {
                text: PROMPT_TEXT
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              categorias: {
                type: Type.ARRAY,
                description: 'Lista de categorías con sus respectivos platos o bebidas',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nombre_categoria: {
                      type: Type.STRING,
                      description: 'Nombre de la categoría del menú'
                    },
                    productos: {
                      type: Type.ARRAY,
                      description: 'Lista de productos dentro de esta categoría',
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          nombre: {
                            type: Type.STRING,
                            description: 'Nombre del plato o producto'
                          },
                          descripcion: {
                            type: Type.STRING,
                            description: 'Descripción breve de ingredientes o receta'
                          },
                          precio: {
                            type: Type.NUMBER,
                            description: 'Precio numérico del ítem'
                          }
                        },
                        required: ['nombre', 'precio']
                      }
                    }
                  },
                  required: ['nombre_categoria', 'productos']
                }
              }
            },
            required: ['categorias']
          }
        }
      });

      if (response && response.text) {
        return JSON.parse(response.text);
      }
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      if (
        msg.includes('no longer available') ||
        msg.includes('not found') ||
        msg.includes('not supported') ||
        msg.includes('is not available')
      ) {
        console.warn(`Modelo ${modelName} no disponible, intentando siguiente...`);
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
  throw new Error('Gemini no devolvió respuesta');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
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

  const { fileBase64, mimeType, geminiApiKey, anthropicApiKey, customKey, provider } =
    (req.body as any) || {};

  // Detección inteligente de API Keys
  const explicitAnthropicHeader = (req.headers['x-anthropic-api-key'] as string)?.trim();
  const explicitGeminiHeader = (req.headers['x-gemini-api-key'] as string)?.trim();

  let detectedGeminiKey = (
    explicitGeminiHeader ||
    geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY
  )?.trim();

  let detectedAnthropicKey = (
    explicitAnthropicHeader ||
    anthropicApiKey ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.VITE_ANTHROPIC_API_KEY
  )?.trim();

  // Si se envió un customKey genérico desde el modal
  const genericCustomKey = (customKey || '').trim();
  if (genericCustomKey) {
    if (genericCustomKey.startsWith('sk-ant-')) {
      detectedAnthropicKey = genericCustomKey;
    } else {
      detectedGeminiKey = genericCustomKey;
    }
  }

  // Filtrar placeholders
  if (detectedGeminiKey === 'tu_clave_aqui' || detectedGeminiKey === 'tu_api_key_aqui') {
    detectedGeminiKey = undefined;
  }
  if (detectedAnthropicKey === 'tu_clave_aqui' || detectedAnthropicKey === 'tu_api_key_aqui') {
    detectedAnthropicKey = undefined;
  }

  const hasAnthropic = Boolean(detectedAnthropicKey);
  const hasGemini = Boolean(detectedGeminiKey);

  if (!hasAnthropic && !hasGemini) {
    return res.status(400).json({
      error: 'API Key de IA no configurada',
      details:
        'Debes configurar ANTHROPIC_API_KEY o GEMINI_API_KEY en las variables de entorno de Vercel (Project Settings → Environment Variables) o ingresar tu clave en la ventana de carga del menú.'
    });
  }

  if (!fileBase64) {
    return res.status(400).json({
      error: 'Cuerpo de solicitud inválido',
      details: 'Se requiere el contenido del archivo en base64 (fileBase64).'
    });
  }

  // Normalizar mimeType
  let resolvedMime = mimeType ? String(mimeType).trim().toLowerCase() : 'image/jpeg';
  if (resolvedMime === 'application/octet-stream' || !resolvedMime) {
    resolvedMime = 'image/jpeg';
  }

  // Limpiar prefijo Data URI
  const cleanBase64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '').trim();

  if (!cleanBase64) {
    return res.status(400).json({
      error: 'Archivo vacío',
      details: 'El contenido base64 del archivo está vacío o no es válido.'
    });
  }

  // Orden de preferencia:
  // Si provider es explícito 'claude' o si hay Anthropic y Gemini falló previamente, o si no hay Gemini
  let preferredEngine: 'anthropic' | 'gemini' = 'gemini';
  if (provider === 'claude' || provider === 'anthropic' || (!hasGemini && hasAnthropic)) {
    preferredEngine = 'anthropic';
  } else if (hasAnthropic) {
    // Si tenemos Claude disponible en variables de entorno, y Gemini reportó denegación previa,
    // Anthropic es un motor de primera clase garantizado.
    preferredEngine = hasGemini ? 'gemini' : 'anthropic';
  }

  let finalResult: any = null;
  let usedEngine: string = preferredEngine;
  let errors: string[] = [];

  // Intento 1: Motor preferido
  if (preferredEngine === 'gemini' && detectedGeminiKey) {
    try {
      finalResult = await parseWithGemini(detectedGeminiKey, cleanBase64, resolvedMime);
      usedEngine = 'Gemini 3.8 Flash';
    } catch (geminiErr: any) {
      const gMsg = String(geminiErr?.message || geminiErr);
      console.warn('Gemini falló en /api/parse-menu:', gMsg);
      errors.push(`Gemini: ${gMsg}`);

      // Fallback automático a Anthropic Claude si está disponible
      if (hasAnthropic && detectedAnthropicKey) {
        console.log('Activando respaldo automático con Claude Vision...');
        try {
          finalResult = await parseWithClaude(detectedAnthropicKey, cleanBase64, resolvedMime);
          usedEngine = 'Claude 4.5 Vision (Respaldo)';
        } catch (claudeErr: any) {
          const cMsg = String(claudeErr?.message || claudeErr);
          console.error('Claude también falló:', cMsg);
          errors.push(`Claude: ${cMsg}`);
        }
      }
    }
  } else if (preferredEngine === 'anthropic' && detectedAnthropicKey) {
    try {
      finalResult = await parseWithClaude(detectedAnthropicKey, cleanBase64, resolvedMime);
      usedEngine = 'Claude 4.5 Vision';
    } catch (claudeErr: any) {
      const cMsg = String(claudeErr?.message || claudeErr);
      console.warn('Claude falló en /api/parse-menu:', cMsg);
      errors.push(`Claude: ${cMsg}`);

      // Fallback a Gemini si está disponible
      if (hasGemini && detectedGeminiKey) {
        try {
          finalResult = await parseWithGemini(detectedGeminiKey, cleanBase64, resolvedMime);
          usedEngine = 'Gemini 3.8 Flash (Respaldo)';
        } catch (geminiErr: any) {
          const gMsg = String(geminiErr?.message || geminiErr);
          errors.push(`Gemini: ${gMsg}`);
        }
      }
    }
  }

  if (finalResult && Array.isArray(finalResult.categorias)) {
    return res.status(200).json({
      ...finalResult,
      provider: usedEngine
    });
  }

  // Si fallaron todos los motores
  console.error('Falla total en /api/parse-menu. Errores:', errors);
  const mainError = errors[0] || 'Error desconocido al procesar el archivo.';
  let detailedMessage = mainError;

  try {
    const jsonStart = detailedMessage.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(detailedMessage.slice(jsonStart));
      if (parsed.error?.message) {
        detailedMessage = parsed.error.message;
      }
    }
  } catch {}

  return res.status(500).json({
    error: 'Error al procesar el menú con IA',
    details: detailedMessage,
    errors
  });
}
