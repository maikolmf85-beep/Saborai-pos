import type { MenuItem, Table } from '../types';
import type { CashRegister } from '../types/cashShift';

export const DEMO_TENANT_ID = 'tenant_demo_local';
export const DEMO_ZONES = ['Salón Principal', 'Terraza', 'Barra'] as const;

export interface DemoSeed {
  zones: string[];
  tables: Table[];
  cashRegisters: CashRegister[];
  menuItems: MenuItem[];
}

/** Datos de muestra inventados; nunca se copian del perfil ni de la nube. */
export function createDemoSeed(): DemoSeed {
  const zones = [...DEMO_ZONES];
  const tables: Table[] = [
    { id: 'demo_table_01', number: 1, name: 'Mesa 1', seats: 4, shape: 'round', status: 'AVAILABLE', zone: 'Salón Principal', x: 24, y: 30 },
    { id: 'demo_table_02', number: 2, name: 'Mesa 2', seats: 4, shape: 'square', status: 'AVAILABLE', zone: 'Salón Principal', x: 50, y: 30 },
    { id: 'demo_table_03', number: 3, name: 'Mesa 3', seats: 2, shape: 'round', status: 'AVAILABLE', zone: 'Salón Principal', x: 76, y: 30 },
    { id: 'demo_table_04', number: 4, name: 'Mesa 4', seats: 4, shape: 'square', status: 'AVAILABLE', zone: 'Terraza', x: 30, y: 38 },
    { id: 'demo_table_05', number: 5, name: 'Mesa 5', seats: 6, shape: 'round', status: 'AVAILABLE', zone: 'Terraza', x: 68, y: 38 },
    { id: 'demo_table_06', number: 6, name: 'Barra 1', seats: 2, shape: 'bar', status: 'AVAILABLE', zone: 'Barra', x: 50, y: 40 }
  ];
  const cashRegisters: CashRegister[] = [
    {
      id: 'demo_register_main',
      name: 'Caja 01 - Principal',
      terminalCode: '00001',
      branchCode: '001',
      isDefault: true,
      allowsBilling: true,
      allowsOrdering: true,
      isActive: true,
      notes: 'Caja ficticia de demostración',
      linkedZone: 'Salón Principal',
      linkedZones: ['Salón Principal', 'Terraza']
    },
    {
      id: 'demo_register_bar',
      name: 'Caja 02 - Barra',
      terminalCode: '00002',
      branchCode: '001',
      allowsBilling: true,
      allowsOrdering: true,
      isActive: true,
      notes: 'Caja ficticia de demostración',
      linkedZone: 'Barra',
      linkedZones: ['Barra']
    }
  ];
  const menuItems: MenuItem[] = [
    {
      id: 'demo_menu_casado', name: 'Casado de muestra', description: 'Pollo, arroz, frijoles y ensalada (producto ficticio).',
      price: 4200, category: 'Cocina', station: 'Cocina', cabysCode: '0000000000000', taxRate: 0.13,
      available: true, imageIcon: '🍛', ingredients: []
    },
    {
      id: 'demo_menu_patacones', name: 'Patacones de muestra', description: 'Porción de patacones (producto ficticio).',
      price: 2600, category: 'Cocina', station: 'Cocina', cabysCode: '0000000000000', taxRate: 0.13,
      available: true, imageIcon: '🍌', ingredients: []
    },
    {
      id: 'demo_menu_jugo', name: 'Jugo natural de muestra', description: 'Jugo natural (producto ficticio).',
      price: 1500, category: 'Bar', station: 'Bar', cabysCode: '0000000000000', taxRate: 0.13,
      available: true, imageIcon: '🥤', ingredients: []
    },
    {
      id: 'demo_menu_postre', name: 'Postre de muestra', description: 'Postre del día (producto ficticio).',
      price: 1800, category: 'Postres', station: 'Postres', cabysCode: '0000000000000', taxRate: 0.13,
      available: true, imageIcon: '🍮', ingredients: []
    }
  ];

  return { zones, tables, cashRegisters, menuItems };
}
