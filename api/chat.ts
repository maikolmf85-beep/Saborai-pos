import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export default async function handler(req, res) {
  // Configurar CORS por si acaso (para desarrollo local)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API Key no está configurada en el servidor (Vercel).' });
    }

    // Usamos gemini-1.5-flash por su rapidez y buen razonamiento
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const systemPrompt = `
Eres Nysa, una asistente personal de inteligencia artificial de Saborai POS.
Eres humana, servicial, muy profesional y de trato cálido. 
El usuario actual es un empleado (salonero, cajero o administrador) del restaurante.
Tu objetivo es ayudarles con dudas sobre el sistema POS, darles recomendaciones sobre cómo vender más, 
y apoyar en cualquier duda sobre menú, maridajes o manejo de inventarios.
Sé concisa, clara y mantén el estilo Premium/Corporativo del sistema Saborai.
Si el usuario te pregunta cosas fuera de contexto, de forma amable indícale que estás aquí para asistirle con las operaciones del restaurante.

Contexto actual del restaurante (inventado para el prompt o pasado dinámicamente):
${context || 'Operando con normalidad.'}
`;

    // Para un chat real, deberíamos pasar el historial, pero para Nysa MVP solo respondemos al mensaje
    // Para simplificar, le mandamos el system prompt como inicio
    const prompt = `${systemPrompt}\n\nMensaje del usuario: ${message}\n\nRespuesta de Nysa:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return res.status(200).json({ text });
  } catch (error: any) {
    console.error('Error in Gemini API:', error);
    return res.status(500).json({ error: 'Error comunicándose con Nysa AI.', details: error.message || String(error) });
  }
}
