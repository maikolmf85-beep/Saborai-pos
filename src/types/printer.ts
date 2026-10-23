export type PrinterConnectionType = 'network' | 'usb' | 'bluetooth';
export type PrinterRole = 'caja' | 'cocina' | 'bar';
export type PrintDeliveryStatus = 'accepted' | 'confirmed' | 'unconfirmed' | 'failed';

export interface PrinterConfig {
  id: string;
  name: string;
  role: PrinterRole;
  connectionType: PrinterConnectionType;
  // Parámetros específicos por protocolo
  ipAddress?: string;     // Para tipo 'network' (ej. 192.168.1.200)
  port?: number;          // Puerto de red (por defecto 9100 u 80/443 para ePOS)
  vendorId?: number;      // Para USB/Serial
  productId?: number;     // ID de producto para USB
  macAddress?: string;    // Para Bluetooth
  serviceUuid?: string;   // UUID de servicio Bluetooth opcional
  paperWidth: '80mm' | '58mm';
  enabled: boolean;
  autoCutter?: boolean;
  openDrawer?: boolean;
  beepOnPrint?: boolean;
}

export interface PrintReceiptData {
  title?: string;
  subtitle?: string;
  orderNumber?: string | number;
  tableName?: string;
  waiterName?: string;
  date?: string;
  items: Array<{
    name: string;
    quantity: number;
    price?: number;
    subtotal?: number;
    notes?: string;
    modifiers?: string[];
  }>;
  subtotal?: number;
  serviceCharge?: number;
  tax?: number;
  total?: number;
  paymentMethod?: string;
  customerName?: string;
  customerTaxId?: string;
  footerNotes?: string[];
  fiscalKey?: string;
  fiscalConsecutive?: string;
  barcode?: string;
  qrCode?: string;
}

export interface PrintResult {
  success: boolean;
  printerId?: string;
  error?: string;
  /** The transport accepted the bytes; this does not mean the paper was printed. */
  accepted?: boolean;
  /** True only when the relay explicitly confirms delivery to the printer. */
  confirmed?: boolean;
  deliveryStatus?: PrintDeliveryStatus;
  warning?: string;
  /** True when the browser fallback needs an operator to verify the physical ticket. */
  confirmationRequired?: boolean;
  methodUsed?: 'network' | 'usb' | 'bluetooth' | 'relay' | 'silent-iframe';
}
