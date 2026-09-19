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

export const sampleMenuItems: MenuItem[] = [
  {
    id: 'prod_1',
    name: 'Ceviche Tico Clásico de Corvina',
    description: 'Corvina reina fresca marinada en limón mandarina, cebolla morada, culantro coyote y plátano tostado.',
    price: 6800,
    category: 'Entradas',
    station: 'Cocina',
    cabysCode: '2121100000100',
    taxRate: 0.13,
    available: true,
    imageIcon: '🐟',
    aiSuggestedPairing: 'Cerveza Artesanal Imperial Silver o Copa Sauvignon Blanc.',
    ingredients: [
      { name: 'Corvina Reina Fresca', requiredQty: 180, unit: 'g', currentStock: 4200 },
      { name: 'Limón Mandarina', requiredQty: 3, unit: 'und', currentStock: 150 },
      { name: 'Cebolla Morada y Culantro', requiredQty: 40, unit: 'g', currentStock: 1800 },
      { name: 'Chips de Plátano Verde', requiredQty: 60, unit: 'g', currentStock: 3500 },
    ]
  },
  {
    id: 'prod_2',
    name: 'Corte Ribeye Angus 350g a la Leña',
    description: 'Corte premium madurado 28 días, mantequilla de ajo confitado, papas rústicas al romero.',
    price: 18500,
    category: 'Platos Fuertes',
    station: 'Cocina',
    cabysCode: '2111100000200',
    taxRate: 0.13,
    available: true,
    imageIcon: '🥩',
    aiSuggestedPairing: 'Vino Tinto Malbec Reserva del Valle o Coctel Smoked Old Fashioned.',
    ingredients: [
      { name: 'Ribeye Angus Certificado', requiredQty: 350, unit: 'g', currentStock: 3850 },
      { name: 'Mantequilla Ajo Confitado', requiredQty: 25, unit: 'g', currentStock: 900 },
      { name: 'Papas Rústicas', requiredQty: 200, unit: 'g', currentStock: 12000 },
    ]
  },
  {
    id: 'prod_3',
    name: 'Gallo Pinto Gourmet con Lomo Saltado',
    description: 'Pinto tradicional con Salsa Lizano artesanal, lomo fino salteado al wok y huevo de pastoreo.',
    price: 7900,
    category: 'Platos Fuertes',
    station: 'Cocina',
    cabysCode: '2121100000300',
    taxRate: 0.13,
    available: true,
    imageIcon: '🍳',
    aiSuggestedPairing: 'Café de Especialidad Chorreado Tarrazú.',
    ingredients: [
      { name: 'Arroz y Frijoles Negros', requiredQty: 250, unit: 'g', currentStock: 18000 },
      { name: 'Lomo de Res Premium', requiredQty: 150, unit: 'g', currentStock: 2500 },
      { name: 'Huevo de Pastoreo', requiredQty: 1, unit: 'und', currentStock: 48 },
    ]
  },
  {
    id: 'prod_4',
    name: 'Cóctel Pasión Tica (Guaro Cacique Artesanal)',
    description: 'Guaro Cacique 50°, maracuyá criollo fresco, infusión de jengibre y escarcha de sal volcánica.',
    price: 4900,
    category: 'Bebidas',
    station: 'Bar',
    cabysCode: '2411000000400',
    taxRate: 0.13,
    available: true,
    imageIcon: '🍸',
    aiSuggestedPairing: 'Tapa de Chicharrones de Cerdo Crujientes.',
    ingredients: [
      { name: 'Guaro Cacique Superior', requiredQty: 60, unit: 'ml', currentStock: 4500 },
      { name: 'Pulpa Maracuyá Natural', requiredQty: 80, unit: 'ml', currentStock: 2800 },
      { name: 'Sirope de Jengibre', requiredQty: 20, unit: 'ml', currentStock: 1200 },
    ]
  },
  {
    id: 'prod_5',
    name: 'Café Geisha Tarrazú Pour-Over',
    description: 'Café de origen único, notas florales de jazmín y miel de abeja, preparado en Chemex.',
    price: 3200,
    category: 'Cafetería',
    station: 'Bar',
    cabysCode: '2139000000500',
    taxRate: 0.13,
    available: true,
    imageIcon: '☕',
    aiSuggestedPairing: 'Tres Leches de Maracuyá.',
    ingredients: [
      { name: 'Grano Geisha Tostado', requiredQty: 22, unit: 'g', currentStock: 850 },
      { name: 'Agua Filtrada Termo', requiredQty: 330, unit: 'ml', currentStock: 50000 },
    ]
  },
  {
    id: 'prod_6',
    name: 'Tres Leches Criollo de Baileys',
    description: 'Bizcocho aireado infusionado con tres leches, licor de crema Baileys y canela de Ceilán.',
    price: 4200,
    category: 'Postres',
    station: 'Cocina',
    cabysCode: '2142000000600',
    taxRate: 0.13,
    available: true,
    imageIcon: '🍰',
    aiSuggestedPairing: 'Espresso Doble o Digestivo de Licor 43.',
    ingredients: [
      { name: 'Porción Bizcocho Tres Leches', requiredQty: 1, unit: 'und', currentStock: 14 },
      { name: 'Crema Baileys y Canela', requiredQty: 30, unit: 'ml', currentStock: 650 },
    ]
  }
];

export const initialTables: Table[] = [
  {
    id: 'tbl_1',
    number: 1,
    name: 'Mesa 1 - Ventanal',
    seats: 4,
    shape: 'square',
    status: 'OCCUPIED',
    zone: 'Principal',
    x: 40,
    y: 40,
    activeOrder: {
      orderNumber: 'ORD-8921',
      server: 'Kevin Murillo',
      openedAt: 'Hace 38 min',
      subAccounts: [
        { id: 1, name: 'Carlos Murillo' },
        { id: 2, name: 'Dra. Elena Vega' }
      ],
      items: [
        {
          id: 'item_1',
          name: 'Ceviche Tico Clásico de Corvina',
          price: 6800,
          quantity: 2,
          subAccountId: 1,
          dinerName: 'Carlos Murillo',
          notes: 'Sin cebolla para uno de ellos',
          cabysCode: '2121100000100',
          taxRate: 0.13,
          category: 'Cocina'
        },
        {
          id: 'item_2',
          name: 'Corte Ribeye Angus 350g a la Leña',
          price: 18500,
          quantity: 1,
          subAccountId: 2,
          dinerName: 'Dra. Elena Vega',
          notes: 'Término medio 3/4',
          cabysCode: '2111100000200',
          taxRate: 0.13,
          category: 'Cocina'
        },
        {
          id: 'item_3',
          name: 'Cóctel Pasión Tica (Guaro Cacique Artesanal)',
          price: 4900,
          quantity: 2,
          subAccountId: 1,
          dinerName: 'Carlos Murillo',
          cabysCode: '2411000000400',
          taxRate: 0.13,
          category: 'Bar'
        }
      ]
    }
  },
  {
    id: 'tbl_2',
    number: 2,
    name: 'Mesa 2 - Central',
    seats: 6,
    shape: 'round',
    status: 'AVAILABLE',
    zone: 'Principal',
    x: 160,
    y: 40,
  },
  {
    id: 'tbl_3',
    number: 3,
    name: 'Mesa 3 - Rincón Íntimo',
    seats: 2,
    shape: 'square',
    status: 'PRE_CHECK',
    zone: 'Principal',
    x: 280,
    y: 40,
    activeOrder: {
      orderNumber: 'ORD-8919',
      server: 'Sofía Calderón',
      openedAt: 'Hace 1h 12 min',
      subAccounts: [
        { id: 1, name: 'Andrés Montero' }
      ],
      items: [
        {
          id: 'item_4',
          name: 'Gallo Pinto Gourmet con Lomo Saltado',
          price: 7900,
          quantity: 2,
          subAccountId: 1,
          dinerName: 'Andrés Montero',
          cabysCode: '2121100000300',
          taxRate: 0.13,
          category: 'Cocina'
        },
        {
          id: 'item_5',
          name: 'Café Geisha Tarrazú Pour-Over',
          price: 3200,
          quantity: 2,
          subAccountId: 1,
          dinerName: 'Andrés Montero',
          cabysCode: '2139000000500',
          taxRate: 0.13,
          category: 'Bar'
        }
      ]
    }
  },
  {
    id: 'tbl_4',
    number: 4,
    name: 'Mesa 4 - Jardín Exterior',
    seats: 4,
    shape: 'square',
    status: 'RESERVED',
    zone: 'Terraza',
    x: 40,
    y: 180,
  },
  {
    id: 'tbl_5',
    number: 5,
    name: 'Mesa 5 - Lounge Terraza',
    seats: 8,
    shape: 'round',
    status: 'AVAILABLE',
    zone: 'Terraza',
    x: 160,
    y: 180,
  },
  {
    id: 'tbl_6',
    number: 6,
    name: 'Barra VIP Banqueta 1-4',
    seats: 4,
    shape: 'bar',
    status: 'OCCUPIED',
    zone: 'Barra VIP',
    x: 280,
    y: 180,
    activeOrder: {
      orderNumber: 'ORD-8924',
      server: 'Esteban Mora',
      openedAt: 'Hace 15 min',
      subAccounts: [
        { id: 1, name: 'Invitado Barra 1' }
      ],
      items: [
        {
          id: 'item_6',
          name: 'Cóctel Pasión Tica (Guaro Cacique Artesanal)',
          price: 4900,
          quantity: 3,
          subAccountId: 1,
          dinerName: 'Invitado Barra 1',
          cabysCode: '2411000000400',
          taxRate: 0.13,
          category: 'Bar'
        }
      ]
    }
  }
];

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
