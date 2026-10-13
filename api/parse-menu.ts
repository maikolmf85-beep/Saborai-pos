import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo se acepta POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY no configurada en las variables de entorno del servidor. Agrega GEMINI_API_KEY en tu archivo .env o en la configuración de Vercel.'
    });
  }

  const { fileBase64, mimeType } = (req.body as any) || {};

  if (!fileBase64 || !mimeType) {
    return res.status(400).json({
      error: 'Cuerpo de solicitud inválido. Se requieren fileBase64 y mimeType.'
    });
  }

  // Limpiar el prefijo Data URI en caso de estar presente
  const cleanBase64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '').trim();

  if (!cleanBase64) {
    return res.status(400).json({
      error: 'El contenido base64 del archivo está vacío o no es válido.'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const promptText = `
Eres un asistente experto en digitalización de cartas y menús de restaurantes para sistemas POS de alta precisión.
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
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: cleanBase64
              }
            },
            {
              text: promptText
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

    const responseText = response.text;
    if (!responseText) {
      return res.status(500).json({ error: 'La IA no devolvió contenido interpretable.' });
    }

    const parsedData = JSON.parse(responseText);
    return res.status(200).json(parsedData);
  } catch (error: any) {
    console.error('Error en /api/parse-menu:', error);
    return res.status(500).json({
      error: 'Error al procesar el menú con Gemini IA',
      details: error?.message || 'Error desconocido en la llamada a Gemini'
    });
  }
}
