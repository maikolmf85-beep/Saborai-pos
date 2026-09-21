import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../utils/supabase';

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

  const { email, password, name, phone, restaurantName, plan } = req.body;

  if (!email || !password || !name || !restaurantName) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    // 1. Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        name,
        phone,
        restaurant_name: restaurantName,
        password_hash: passwordHash,
      })
      .select()
      .single();

    if (userError || !newUser) {
      console.error('Error creating user:', userError);
      return res.status(500).json({ error: 'Error al crear usuario' });
    }

    // 4. Create tenant
    const { data: newTenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        user_id: newUser.id,
        name: restaurantName,
        email: email.toLowerCase(),
        phone,
        plan: plan || 'pro',
      })
      .select()
      .single();

    if (tenantError || !newTenant) {
      console.error('Error creating tenant:', tenantError);
      return res.status(500).json({ error: 'Error al crear tenant' });
    }

    // 5. Create subscription
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { data: newSubscription, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: newUser.id,
        tenant_id: newTenant.id,
        mode: 'TRIAL',
        plan: plan || 'pro',
        trial_ends_at: trialEnd.toISOString(),
      })
      .select()
      .single();

    if (subError || !newSubscription) {
      console.error('Error creating subscription:', subError);
      return res.status(500).json({ error: 'Error al crear suscripción' });
    }

    // 6. Generate JWT
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-for-development';
    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, jwtSecret, { expiresIn: '7d' });

    // 7. Remove password hash from response
    delete newUser.password_hash;

    res.status(200).json({
      success: true,
      token,
      user: newUser,
      tenant: newTenant,
      subscription: newSubscription
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}
