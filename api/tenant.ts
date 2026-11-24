import type { VercelRequest, VercelResponse } from '@vercel/node';
import onboardingHandler from './_utils/tenantOnboarding.js';
import profileHandler from './_utils/tenantProfile.js';
import floorplanHandler from './_utils/branchFloorplan.js';

export function tenantActionFromQuery(action: unknown): 'onboarding' | 'profile' | 'floorplan' | null {
  const value = Array.isArray(action) ? action[0] : action;
  return value === 'onboarding' || value === 'profile' || value === 'floorplan' ? value : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = tenantActionFromQuery(req.query.action);
  if (action === 'onboarding') return onboardingHandler(req, res);
  if (action === 'profile') return profileHandler(req, res);
  if (action === 'floorplan') return floorplanHandler(req, res);
  return res.status(404).json({ error: 'Ruta de tenant no encontrada.' });
}
