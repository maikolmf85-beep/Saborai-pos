export type SubscriptionPlan = 'express' | 'pro' | 'multibranch';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIAL';
export type TaxRegime = 'TRADITIONAL' | 'SIMPLIFIED'; // Régimen Normal/General vs Régimen Simplificado (Hacienda CR)

export interface HaciendaConfig {
  environment: 'sandbox' | 'production';
  atvUsername: string;
  atvPassword?: string;
  pinP12: string;
  p12FileName?: string;
  p12Base64?: string;
  tipoIdentificacion?: '01' | '02' | '03' | '04';
  codigoActividad?: string;
  // Ubicación del emisor: debe coincidir exactamente con la registrada en ATV
  provincia?: string; // 1 dígito
  canton?: string; // 2 dígitos
  distrito?: string; // 2 dígitos
  otrasSenas?: string;
  proveedorSistemas?: string; // Cédula del proveedor de sistemas (v4.4). Si vacío se usa la del emisor.
  sucursal?: string;
  terminal?: string;
  certExpiresOn?: string;
  isValidated?: boolean;
  lastTestedAt?: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  cedulaJuridica: string;
  email: string;
  phone: string;
  location: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  gracePeriodEndsAt?: string;
  currency: 'CRC' | 'USD';
  monthlyFee: number;
  taxRegime?: TaxRegime;
  includeService10ByDefault?: boolean;
  zones?: string[]; // Dynamic zones for the tenant
  menuCategories?: string[]; // Custom dynamic categories for menu items
  onboardingCompleted?: boolean;
  haciendaConfig?: HaciendaConfig;
}

export type UserRole = 'ADMIN' | 'SALONERO' | 'CAJERO' | 'SALONERO_CAJA' | 'WAITER';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  restaurantName: string;
  role: UserRole;
  pin?: string;
  active?: boolean;
}

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'PRE_CHECK' | 'RESERVED';

export interface SubAccount {
  id: number;
  name: string; // Nombre del comensal (ej. "Carlos Gómez", "María P.", "Invitado 1")
}

export interface MenuModifierChoice {
  name: string;
  extraPrice?: number;
}

export interface MenuModifier {
  id: string;
  name: string; // e.g. "Término de la carne", "Salsa", "Acompañamiento"
  isRequired: boolean;
  multiple: boolean; // if true, can select multiple choices
  choices: MenuModifierChoice[];
}

export interface TableItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  subAccountId?: number; // ID de la subcuenta del comensal
  dinerName?: string; // Nombre directo del comensal
  notes?: string;
  cabysCode: string;
  taxRate: number; // 0.13, 0.04, 0.02, 0.01, 0
  category: string; // Dynamic custom categories
  subcategory?: string; // Subcategory for further filtering
  recipeIngredients?: { ingredient: string; qty: number; unit: string }[];
  selectedModifiers?: { modifierName: string; choiceName: string; extraPrice?: number }[];
  kdsStatus?: 'PENDING' | 'IN_PREPARATION' | 'READY' | 'SERVED';
  kdsOrderId?: string;
}

export interface ActiveOrder {
  orderNumber: string;
  server: string;
  openedAt: string;
  subAccounts: SubAccount[];
  items: TableItem[];
}

export interface Table {
  id: string;
  number: number;
  name: string;
  seats: number;
  shape: 'square' | 'round' | 'bar';
  status: TableStatus;
  zone: string;
  x: number;
  y: number;
  rotation?: number; // Added rotation for rectangular/bar tables
  activeOrder?: ActiveOrder;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  subcategory?: string;
  station: 'Cocina' | 'Bar' | 'Postres';
  cabysCode: string;
  taxRate: number;
  available: boolean;
  imageIcon: string;
  ingredients: { name: string; requiredQty: number; unit: string; currentStock: number }[];
  aiSuggestedPairing?: string;
  prepTime?: number; // Tiempo estimado de preparación en minutos
  modifiers?: MenuModifier[]; // Opciones/modificadores para el platillo
}

export interface KDSOrder {
  id: string;
  tableNumber: number;
  tableName: string;
  server: string;
  timestamp: Date;
  status: 'PENDING' | 'IN_PREPARATION' | 'READY' | 'SERVED';
  station: 'Cocina' | 'Bar';
  targetPrepTime?: number; // Maximum prep time in minutes for items in this order
  items: {
    id?: string;
    name: string;
    quantity: number;
    notes?: string;
    modifiers?: string[]; // Modificadores elegidos
    completed?: boolean;
  }[];
}

export interface PrinterDevice {
  id: string;
  name: string;
  connectionType: 'IP' | 'BLUETOOTH' | 'USB' | 'SPOOLER';
  ipAddress?: string;
  port?: number;
  paperWidth: '58mm' | '80mm';
  autoCutter: boolean;
  printLogo: boolean;
  assignedStation: 'COCINA' | 'BAR' | 'PRECUENTA' | 'FACTURACION';
  status: 'ONLINE' | 'OFFLINE';
}

export interface ElectronicInvoiceCR {
  clave50Digitos: string;
  consecutivo: string;
  emisor: {
    nombre: string;
    cedulaJuridica: string;
    nombreComercial: string;
    correo: string;
    sucursal: string;
    terminal: string;
  };
  receptor: {
    nombre: string;
    tipoIdentificacion: '01-Fisica' | '02-Juridica' | '03-DIMEX' | '04-NITE';
    identificacion: string;
    correo: string;
  };
  fechaEmision: string;
  condicionVenta: '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito';
  tipoDocumento?: 'FE' | 'TE'; // FE = Factura Electrónica (01), TE = Tiquete Electrónico (04)
  codigoActividadReceptor?: string;
  pagos?: { tipo: 'efectivo' | 'tarjeta' | 'sinpe' | 'otros'; monto: number }[];
  errorMensaje?: string; // Motivo de rechazo devuelto por Hacienda
  medioPago: string;
  moneda: 'CRC' | 'USD';
  tipoCambio: number;
  items: TableItem[];
  subtotal: number;
  iva13: number;
  iva4: number;
  iva2: number;
  iva1: number;
  servicio10: number;
  totalComprobante: number;
  estadoHacienda: 'ACEPTADO' | 'PROCESANDO' | 'RECHAZADO' | 'ANULADO';
  xmlContent?: string;
  signedXmlContent?: string;
}
