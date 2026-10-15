import { Table, MenuItem, PrinterDevice, TenantInfo } from '../types';

export const initialTenant: TenantInfo = {
  id: 'tenant_default',
  name: 'Mi Restaurante',
  cedulaJuridica: '',
  email: '',
  phone: '',
  location: '',
  plan: 'pro',
  status: 'ACTIVE',
  currency: 'CRC',
  monthlyFee: 45000,
  taxRegime: 'TRADITIONAL',
  includeService10ByDefault: true,
  zones: [],
  menuCategories: []
};

export const sampleMenuItems: MenuItem[] = [];

export const initialTables: Table[] = [];

export const initialPrinters: PrinterDevice[] = [];
