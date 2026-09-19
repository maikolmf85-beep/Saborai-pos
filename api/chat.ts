import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
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
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in environment variables');
    return res.status(500).json({
      error: 'La API Key de Gemini no está configurada en Vercel. Ve a Settings → Environment Variables y agrega GEMINI_API_KEY.'
    });
  }

  try {
    const { message, context } = req.body as { message?: string; context?: string };

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // gemini-2.0-flash es el modelo más rápido y gratuito
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Eres Nysa, la asistente de inteligencia artificial personal de Saborai POS.
Eres servicial, profesional, amigable y de trato cálido.
Ayudas a empleados del restaurante (saloneros, cajeros y administradores) con:
- Dudas sobre el sistema POS Saborai
- Recomendaciones para vender más
- Preguntas sobre menú, maridajes e inventarios
- Soporte general de operaciones del restaurante

Contexto del sistema:
${context || 'El empleado está operando el sistema Saborai POS.'}

Responde siempre en español, de forma concisa y clara. 
Si te preguntan algo fuera del contexto de restaurante/POS, redirige amablemente la conversación.

Mensaje del empleado: ${message}

Respuesta de Nysa:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    return res.status(200).json({ text });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error calling Gemini API:', errMsg);
    return res.status(500).json({
      error: 'Error al conectar con Gemini AI.',
      details: errMsg
    });
  }
}
