import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  // Aquí iría la integración real con un proveedor de correo (SendGrid, Resend, etc.)
  // Por ahora, simulamos el envío exitoso.
  console.log(`[Simulación] Se solicitó restablecimiento de contraseña para: ${email}`);

  // Retornamos éxito para la UI
  return res.status(200).json({ 
    success: true, 
    message: 'Te hemos enviado las instrucciones a tu correo electrónico.' 
  });
}
