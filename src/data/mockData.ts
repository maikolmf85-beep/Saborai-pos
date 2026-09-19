import { Table, MenuItem, PrinterDevice, TenantInfo } from '../types';

export const initialTenant: TenantInfo = {
  id: 'tenant_saborai_cr_001',
  name: 'Restaurante Fuego & Palmera S.A.',
  cedulaJuridica: '3-101-789456',
  email: 'administracion@fuegopalmera.cr',
  phone: '+506 2289-4500',
  location: 'Escazú Village, San José, Costa Rica',
  plan: 'pro',
  status: 'ACTIVE',
  currency: 'CRC',
  monthlyFee: 45000,
  taxRegime: 'TRADITIONAL',
  includeService10ByDefault: true,
};

export const sampleMenuItems: MenuItem[] = [];

export const initialTables: Table[] = [];

export const initialPrinters: PrinterDevice[] = [
  {
    id: 'prn_1',
    name: 'Comandera Térmica Cocina Caliente',
    connectionType: 'IP',
    ipAddress: '192.168.1.150',
    port: 9100,
    paperWidth: '80mm',
    autoCutter: true,
    printLogo: true,
    assignedStation: 'COCINA',
    status: 'ONLINE'
  },
  {
    id: 'prn_2',
    name: 'Impresora Bluetooth Bar & Coctelería',
    connectionType: 'BLUETOOTH',
    paperWidth: '58mm',
    autoCutter: false,
    printLogo: false,
    assignedStation: 'BAR',
    status: 'ONLINE'
  },
  {
    id: 'prn_3',
    name: 'Caja Principal USB Facturación CR',
    connectionType: 'USB',
    paperWidth: '80mm',
    autoCutter: true,
    printLogo: true,
    assignedStation: 'FACTURACION',
    status: 'ONLINE'
  }
];
