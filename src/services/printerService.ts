import { PrinterConfig, PrinterRole, PrintReceiptData, PrintResult } from '../types/printer';
import { getTenantItem, setTenantItem } from './tenantStorage';

const PRINTERS_STORAGE_KEY = 'printers_config_v2';
const DEFAULT_PRINT_RELAY_URL = 'http://127.0.0.1:8080/print';

// ESC/POS Commands Constants
const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private buffer: number[] = [];

  constructor() {
    this.init();
  }

  // Initialize printer
  init(): this {
    this.buffer.push(ESC, 0x40);
    return this;
  }

  // Set line alignment: 0 = left, 1 = center, 2 = right
  align(align: 'left' | 'center' | 'right'): this {
    const val = align === 'center' ? 1 : align === 'right' ? 2 : 0;
    this.buffer.push(ESC, 0x61, val);
    return this;
  }

  // Bold text
  bold(enable: boolean = true): this {
    this.buffer.push(ESC, 0x45, enable ? 1 : 0);
    return this;
  }

  // Double size / Emphasis
  size(size: 'normal' | 'double-height' | 'double-width' | 'double'): this {
    let val = 0x00;
    if (size === 'double-height') val = 0x10;
    if (size === 'double-width') val = 0x20;
    if (size === 'double') val = 0x30;
    this.buffer.push(GS, 0x21, val);
    return this;
  }

  // Underline
  underline(enable: boolean = true): this {
    this.buffer.push(ESC, 0x2d, enable ? 1 : 0);
    return this;
  }

  // Print text using UTF-8 or compatible ASCII mapping
  text(str: string): this {
    // Normalizar tildes y caracteres especiales para impresoras térmicas (CP437 o ASCII)
    const normalized = str
      .replace(/[áäà]/g, 'a')
      .replace(/[éëè]/g, 'e')
      .replace(/[íïì]/g, 'i')
      .replace(/[óöò]/g, 'o')
      .replace(/[úüù]/g, 'u')
      .replace(/[ñ]/g, 'n')
      .replace(/[ÁÄÀ]/g, 'A')
      .replace(/[ÉËÈ]/g, 'E')
      .replace(/[ÍÏÌ]/g, 'I')
      .replace(/[ÓÖÒ]/g, 'O')
      .replace(/[ÚÜÙ]/g, 'U')
      .replace(/[Ñ]/g, 'N')
      .replace(/₡/g, 'CRC ');

    for (let i = 0; i < normalized.length; i++) {
      this.buffer.push(normalized.charCodeAt(i) & 0xff);
    }
    return this;
  }

  // Text line with linefeed
  line(str: string = ''): this {
    if (str) this.text(str);
    this.buffer.push(0x0a);
    return this;
  }

  // Print a horizontal separator line based on paper width
  separator(char: string = '-', width: number = 42): this {
    const lineStr = char.repeat(width).slice(0, width);
    return this.line(lineStr);
  }

  // Two-column row: left aligned label and right aligned value
  twoColumnRow(left: string, right: string, width: number = 42): this {
    const leftTrim = left.slice(0, width - right.length - 1);
    const spacesNeeded = Math.max(1, width - leftTrim.length - right.length);
    const formatted = leftTrim + ' '.repeat(spacesNeeded) + right;
    return this.line(formatted);
  }

  // Beep sound
  beep(): this {
    this.buffer.push(ESC, 0x42, 0x02, 0x02);
    return this;
  }

  // Open cash drawer (pin 2 pulse)
  openCashDrawer(): this {
    this.buffer.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  // Cut paper (partial or full)
  cut(partial: boolean = true): this {
    // Feed 3 lines then cut
    this.buffer.push(0x0a, 0x0a, 0x0a);
    this.buffer.push(GS, 0x56, partial ? 0x42 : 0x41, 0x00);
    return this;
  }

  // Build binary Uint8Array
  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

interface USBEndpoint {
  direction: 'in' | 'out';
  endpointNumber: number;
}

interface USBDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: {
    interfaces: Array<{
      alternate?: {
        endpoints: USBEndpoint[];
      };
    }>;
  } | null;
  open(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<unknown>;
}

interface BluetoothRemoteGATTCharacteristic {
  properties: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothDevice {
  id?: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryServices(): Promise<Array<{
        getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
      }>>;
    }>;
    getPrimaryServices(): Promise<Array<{
      getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
    }>>;
  };
}

export class PrinterService {
  private printers: PrinterConfig[] = [];
  private tenantId: string | null = null;
  // Conexiones activas WebUSB
  private usbDeviceCache: Map<string, USBDevice> = new Map();
  // Conexiones activas WebBluetooth
  private bluetoothDeviceCache: Map<string, BluetoothDevice> = new Map();
  // Deduplicación de solicitudes concurrentes por impresora y trabajo lógico.
  private inFlightPrints: Map<string, Promise<PrintResult>> = new Map();

  constructor() {
    this.printers = [];
  }

  private createPrintJobId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `print_${crypto.randomUUID()}`;
    }
    return `print_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  public setTenantContext(tenantId: string): void {
    if (!tenantId || this.tenantId === tenantId) return;
    this.tenantId = tenantId;
    this.usbDeviceCache.clear();
    this.bluetoothDeviceCache.clear();
    this.loadPrinters();
  }

  /**
   * Cargar impresoras desde almacenamiento local
   */
  public loadPrinters(): PrinterConfig[] {
    if (!this.tenantId) {
      this.printers = [];
      return this.printers;
    }
    try {
      const stored = getTenantItem<PrinterConfig[]>(PRINTERS_STORAGE_KEY, this.tenantId);
      this.printers = Array.isArray(stored) ? stored : [];
      this.savePrinters();
    } catch {
      this.printers = [];
    }
    return this.printers;
  }

  /**
   * Guardar impresoras en almacenamiento local
   */
  public savePrinters(): void {
    if (!this.tenantId) return;
    try {
      setTenantItem(PRINTERS_STORAGE_KEY, this.printers, this.tenantId);
    } catch (e) {
      console.error('Error saving printers to localStorage', e);
    }
  }

  public getPrinters(): PrinterConfig[] {
    return this.printers;
  }

  public getPrintersByRole(role: PrinterRole): PrinterConfig[] {
    return this.printers.filter(p => p.role === role && p.enabled);
  }

  public getPrinterById(id: string): PrinterConfig | undefined {
    return this.printers.find(p => p.id === id);
  }

  public savePrinter(printer: PrinterConfig): void {
    const idx = this.printers.findIndex(p => p.id === printer.id);
    if (idx >= 0) {
      this.printers[idx] = { ...printer };
    } else {
      this.printers.push({ ...printer });
    }
    this.savePrinters();
  }

  public deletePrinter(id: string): void {
    this.printers = this.printers.filter(p => p.id !== id);
    this.savePrinters();
  }

  /**
   * Emparejar y autorizar impresora WebUSB
   */
  public async requestUsbDevice(printerId: string): Promise<{ success: boolean; vendorId?: number; productId?: number; error?: string }> {
    try {
      if (!('usb' in navigator)) {
        return { success: false, error: 'WebUSB no está soportado en este navegador. Utiliza Google Chrome o Microsoft Edge.' };
      }

      // @ts-ignore
      const device: USBDevice = await navigator.usb.requestDevice({
        filters: [] // Aceptar impresoras de cualquier fabricante
      });

      if (!device) {
        return { success: false, error: 'No se seleccionó ningún dispositivo USB.' };
      }

      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);

      this.usbDeviceCache.set(printerId, device);

      // Actualizar la impresora con el vendorId y productId
      const printer = this.getPrinterById(printerId);
      if (printer) {
        printer.vendorId = device.vendorId;
        printer.productId = device.productId;
        this.savePrinter(printer);
      }

      return {
        success: true,
        vendorId: device.vendorId,
        productId: device.productId
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error solicitando dispositivo WebUSB' };
    }
  }

  /**
   * Emparejar y autorizar impresora Web Bluetooth
   */
  public async requestBluetoothDevice(printerId: string): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      if (!('bluetooth' in navigator)) {
        return { success: false, error: 'Web Bluetooth no está soportado en este navegador. Utiliza Chrome o Android.' };
      }

      // @ts-ignore
      const device: BluetoothDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb', // ESC/POS Generic Thermal
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent
          '0000e0ff-0000-1000-8000-00805f9b34fb'
        ]
      });

      if (!device) {
        return { success: false, error: 'No se seleccionó ninguna impresora Bluetooth.' };
      }

      this.bluetoothDeviceCache.set(printerId, device);

      const printer = this.getPrinterById(printerId);
      if (printer) {
        printer.name = printer.name || device.name || 'Impresora Bluetooth POS';
        this.savePrinter(printer);
      }

      return { success: true, name: device.name };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error al conectar por Bluetooth' };
    }
  }

  /**
   * Construir el buffer ESC/POS a partir de los datos del comprobante o comanda
   */
  public buildReceiptEscPos(data: PrintReceiptData, config: PrinterConfig): Uint8Array {
    const builder = new EscPosBuilder();
    const cols = config.paperWidth === '58mm' ? 32 : 42;

    builder.init();

    if (config.openDrawer) {
      builder.openCashDrawer();
    }

    if (config.beepOnPrint) {
      builder.beep();
    }

    // Encabezado
    builder.align('center');
    if (data.title) {
      builder.bold(true).size('double-height').line(data.title).size('normal').bold(false);
    }
    if (data.subtitle) {
      builder.line(data.subtitle);
    }

    builder.separator('=', cols);

    // Meta datos: Mesa, Mozo, Fecha
    builder.align('left');
    if (data.orderNumber) {
      builder.bold(true).line(`ORDEN #: ${data.orderNumber}`).bold(false);
    }
    if (data.tableName) {
      builder.twoColumnRow(`Mesa: ${data.tableName}`, data.waiterName ? `Mesero: ${data.waiterName}` : '', cols);
    }
    if (data.date) {
      builder.line(`Fecha: ${data.date}`);
    }

    builder.separator('-', cols);

    // Items de comanda o factura
    builder.bold(true);
    builder.twoColumnRow('CANT  DESCRIPCION', 'TOTAL', cols);
    builder.bold(false);
    builder.separator('-', cols);

    data.items.forEach(item => {
      const cantStr = `${item.quantity}x `.padEnd(4, ' ');
      const priceStr = item.subtotal !== undefined ? item.subtotal.toLocaleString() : (item.price ? (item.price * item.quantity).toLocaleString() : '');
      builder.twoColumnRow(`${cantStr}${item.name}`, priceStr, cols);

      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach(m => {
          builder.line(`  + ${m}`);
        });
      }
      if (item.notes) {
        builder.bold(true).line(`  * NOTA: ${item.notes}`).bold(false);
      }
    });

    builder.separator('-', cols);

    // Totales
    if (data.subtotal !== undefined || data.total !== undefined) {
      if (data.subtotal !== undefined) {
        builder.twoColumnRow('Subtotal:', data.subtotal.toLocaleString(), cols);
      }
      if (data.serviceCharge !== undefined && data.serviceCharge > 0) {
        builder.twoColumnRow('Servicio 10% (Ley 4946):', data.serviceCharge.toLocaleString(), cols);
      }
      if (data.tax !== undefined && data.tax > 0) {
        builder.twoColumnRow('I.V.A.:', data.tax.toLocaleString(), cols);
      }
      builder.separator('=', cols);
      if (data.total !== undefined) {
        builder.bold(true).size('double-height');
        builder.twoColumnRow('TOTAL:', `CRC ${data.total.toLocaleString()}`, cols);
        builder.size('normal').bold(false);
      }
    }

    // Datos fiscales
    if (data.fiscalConsecutive) {
      builder.align('center');
      builder.line(`Consecutivo: ${data.fiscalConsecutive}`);
    }
    if (data.fiscalKey) {
      builder.align('center');
      builder.line(`Clave Fiscal:`);
      builder.line(data.fiscalKey);
    }

    // Pie de página
    if (data.footerNotes && data.footerNotes.length > 0) {
      builder.separator('-', cols);
      builder.align('center');
      data.footerNotes.forEach(fn => builder.line(fn));
    }

    // Corte
    if (config.autoCutter !== false) {
      builder.cut(true);
    } else {
      builder.line().line().line();
    }

    return builder.build();
  }

  /**
   * Enviar a imprimir directamente a través de una impresora configurada
   */
  public async printToConfig(printer: PrinterConfig, receiptData: PrintReceiptData): Promise<PrintResult> {
    const printJobId = receiptData.printJobId || this.createPrintJobId();
    const printData = { ...receiptData, printJobId };
    const requestKey = `${printer.id}:${printJobId}`;
    const inFlight = this.inFlightPrints.get(requestKey);
    if (inFlight) return inFlight;

    const request = this.printToConfigInternal(printer, printData);
    this.inFlightPrints.set(requestKey, request);
    void request.finally(() => {
      if (this.inFlightPrints.get(requestKey) === request) {
        this.inFlightPrints.delete(requestKey);
      }
    }).catch(() => {});
    return request;
  }

  private async printToConfigInternal(printer: PrinterConfig, receiptData: PrintReceiptData): Promise<PrintResult> {
    if (!printer.enabled) {
      return { success: false, printJobId: receiptData.printJobId, error: 'La impresora está deshabilitada en la configuración.' };
    }

    const rawEscPos = this.buildReceiptEscPos(receiptData, printer);

    // 1. Red (Network / Ethernet / Wi-Fi)
    if (printer.connectionType === 'network') {
      return this.printNetwork(printer, rawEscPos, receiptData.printJobId!);
    }

    // 2. USB (WebUSB nativo o Bridge)
    if (printer.connectionType === 'usb') {
      return this.printUsb(printer, rawEscPos, receiptData);
    }

    // 3. Bluetooth (Web Bluetooth directo)
    if (printer.connectionType === 'bluetooth') {
      return this.printBluetooth(printer, rawEscPos, receiptData);
    }

    return { success: false, printJobId: receiptData.printJobId, error: 'Tipo de conexión no reconocido.' };
  }

  /**
   * Impresión por Red / Ethernet / IP
   * Envía la carga útil a la pasarela local SaborAI Print Relay
   * (http://127.0.0.1:8080/print). Si la pasarela no está disponible, falla de forma
   * explícita: nunca se debe enviar una comanda IP a la impresora predeterminada
   * del navegador.
   */
  private async printNetwork(printer: PrinterConfig, rawData: Uint8Array, printJobId: string): Promise<PrintResult> {
    const ip = printer.ipAddress || '192.168.1.200';
    const port = printer.port || 9100;
    const attempt = 1;

    // Intento 1: Saborai Print Relay local / bridge ePOS
    try {
      const base64Data = btoa(String.fromCharCode(...rawData));
      const response = await fetch(DEFAULT_PRINT_RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip,
          port,
          printJobId,
          idempotencyKey: `${printJobId}:${printer.id}`,
          attempt,
          data: base64Data,
          paperWidth: printer.paperWidth
        }),
        signal: AbortSignal.timeout(2500)
      });

      if (response.ok) {
        const confirmed = await this.hasRelayPrintConfirmation(response);
        return {
          success: true,
          printJobId,
          attempt,
          accepted: true,
          confirmed,
          deliveryStatus: confirmed ? 'confirmed' : 'accepted',
          printerId: printer.id,
          methodUsed: 'relay',
          warning: confirmed
            ? undefined
            : 'El relay aceptó el trabajo, pero no devolvió confirmación de que la impresora terminó de procesarlo. Verifica el ticket.'
        };
      }
    } catch {
      // El relay no está disponible; no cambiar silenciosamente de impresora.
    }

    return {
      success: false,
      printJobId,
      attempt,
      accepted: false,
      confirmed: false,
      deliveryStatus: 'failed',
      printerId: printer.id,
      error: `No se pudo conectar con la impresora de red "${printer.name}" en ${ip}:${port}. Se evitó enviarlo a la impresora predeterminada del navegador. Verifica que el relay local esté activo y que la impresora esté disponible.`
    };
  }

  /**
   * Un HTTP 2xx solo confirma que el relay recibió la solicitud. La confirmación
   * física debe venir explícitamente en el cuerpo del relay.
   */
  private async hasRelayPrintConfirmation(response: Response): Promise<boolean> {
    try {
      const payload = await response.clone().json() as Record<string, unknown>;
      return payload.printed === true
        || payload.delivered === true
        || payload.status === 'printed'
        || payload.status === 'delivered';
    } catch {
      return false;
    }
  }

  /**
   * Impresión por WebUSB directo sin ventana de diálogo
   */
  private async printUsb(printer: PrinterConfig, rawData: Uint8Array, fallbackData: PrintReceiptData): Promise<PrintResult> {
    try {
      let device = this.usbDeviceCache.get(printer.id);

      if (!device && 'usb' in navigator) {
        // @ts-ignore
        const pairedDevices: USBDevice[] = await navigator.usb.getDevices();
        if (printer.vendorId) {
          device = pairedDevices.find(d => d.vendorId === printer.vendorId);
        } else if (pairedDevices.length > 0) {
          device = pairedDevices[0];
        }
      }

      if (device) {
        if (!device.opened) {
          await device.open();
        }
        if (device.configuration === null) {
          await device.selectConfiguration(1);
        }
        try {
          await device.claimInterface(0);
        } catch {
          // Ya estaba reclamada
        }

        // Buscar endpoint de salida (OUT)
        const iface = device.configuration?.interfaces[0];
        const endpoint = iface?.alternate?.endpoints.find(e => e.direction === 'out');
        const endpointNumber = endpoint ? endpoint.endpointNumber : 1;

        // @ts-ignore
        await device.transferOut(endpointNumber, rawData);
        return {
          success: true,
          printJobId: fallbackData.printJobId,
          accepted: true,
          confirmed: false,
          deliveryStatus: 'accepted',
          printerId: printer.id,
          methodUsed: 'usb',
          warning: 'USB aceptó los bytes, pero no devuelve confirmación de que la impresora terminó de imprimir. Verifica el ticket.'
        };
      }

      // Si no hay permiso WebUSB aún, abrir el fallback sin confirmar éxito.
      const triggered = await this.printSilentIframe(fallbackData, printer);
      return this.unconfirmedBrowserPrintResult(printer, triggered, fallbackData.printJobId);
    } catch (err: any) {
      // Fallback USB sin confirmar que el ticket fue impreso.
      try {
        const triggered = await this.printSilentIframe(fallbackData, printer);
        return this.unconfirmedBrowserPrintResult(printer, triggered, fallbackData.printJobId);
      } catch (fallbackError: any) {
        return {
          success: false,
          printJobId: fallbackData.printJobId,
          accepted: false,
          confirmed: false,
          deliveryStatus: 'failed',
          printerId: printer.id,
          methodUsed: 'silent-iframe',
          error: fallbackError.message || err.message || 'No se pudo imprimir por USB.'
        };
      }
    }
  }

  /**
   * Impresión por Web Bluetooth directa sin ventanas de diálogo
   */
  private async printBluetooth(printer: PrinterConfig, rawData: Uint8Array, fallbackData: PrintReceiptData): Promise<PrintResult> {
    try {
      const device = this.bluetoothDeviceCache.get(printer.id);

      if (device && device.gatt) {
        const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
        
        // Servicios estándar de impresoras térmicas Bluetooth
        const services = await server.getPrimaryServices();
        let writeChar: BluetoothRemoteGATTCharacteristic | null = null;

        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                writeChar = char;
                break;
              }
            }
          } catch {
            continue;
          }
          if (writeChar) break;
        }

        if (writeChar) {
          // Enviar en bloques de 512 bytes (límite MTU BLE)
          const chunkSize = 512;
          for (let i = 0; i < rawData.length; i += chunkSize) {
            const chunk = rawData.slice(i, i + chunkSize);
            if (writeChar.properties.writeWithoutResponse) {
              await writeChar.writeValueWithoutResponse(chunk);
            } else {
              await writeChar.writeValue(chunk);
            }
          }
          return {
            success: true,
            printJobId: fallbackData.printJobId,
            accepted: true,
            confirmed: false,
            deliveryStatus: 'accepted',
            printerId: printer.id,
            methodUsed: 'bluetooth',
            warning: 'Bluetooth aceptó los bytes, pero no devuelve confirmación de que la impresora terminó de imprimir. Verifica el ticket.'
          };
        }
      }

      // Fallback Bluetooth sin confirmar que el ticket fue impreso.
      const triggered = await this.printSilentIframe(fallbackData, printer);
      return this.unconfirmedBrowserPrintResult(printer, triggered, fallbackData.printJobId);
    } catch (err: any) {
      // Fallback Bluetooth sin confirmar que el ticket fue impreso.
      try {
        const triggered = await this.printSilentIframe(fallbackData, printer);
        return this.unconfirmedBrowserPrintResult(printer, triggered, fallbackData.printJobId);
      } catch (fallbackError: any) {
        return {
          success: false,
          printJobId: fallbackData.printJobId,
          accepted: false,
          confirmed: false,
          deliveryStatus: 'failed',
          printerId: printer.id,
          methodUsed: 'silent-iframe',
          error: fallbackError.message || err.message || 'No se pudo imprimir por Bluetooth.'
        };
      }
    }
  }

  /**
   * El navegador puede abrir el diálogo, pero no expone una confirmación de que el
   * usuario imprimió el ticket. Por eso este resultado siempre es un fallo no
   * confirmado y debe mostrarse como tal en caja.
   */
  private unconfirmedBrowserPrintResult(printer: PrinterConfig, triggered: boolean, printJobId?: string): PrintResult {
    return {
      success: false,
      printJobId,
      accepted: false,
      confirmed: false,
      deliveryStatus: 'unconfirmed',
      printerId: printer.id,
      methodUsed: 'silent-iframe',
      confirmationRequired: true,
      error: triggered
        ? 'Se abrió el fallback de impresión del navegador, pero SaborAI no puede confirmar que el ticket fue impreso. Verifica el ticket antes de continuar.'
        : 'No se pudo abrir el fallback de impresión del navegador.'
    };
  }

  /**
   * Generador de Ticket HTML para renderizado silencioso en iFrame
   */
  public generateTicketHtml(data: PrintReceiptData, config: PrinterConfig): string {
    const is58 = config.paperWidth === '58mm';
    const widthPx = is58 ? '48mm' : '72mm';

    const itemsHtml = data.items.map(item => `
      <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
        <span style="font-weight: bold; width: 22px;">${item.quantity}x</span>
        <span style="flex: 1; padding: 0 4px;">${item.name}</span>
        <span style="font-weight: bold;">${item.subtotal !== undefined ? item.subtotal.toLocaleString() : (item.price ? (item.price * item.quantity).toLocaleString() : '')}</span>
      </div>
      ${item.modifiers && item.modifiers.length > 0 ? `<div style="font-size: 9px; padding-left: 26px; color: #555;">${item.modifiers.join(', ')}</div>` : ''}
      ${item.notes ? `<div style="font-size: 9px; padding-left: 26px; font-weight: bold;">* NOTA: ${item.notes}</div>` : ''}
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>SaborAI Receipt</title>
        <style>
          @page {
            size: ${config.paperWidth} auto;
            margin: 0;
          }
          body {
            font-family: 'Courier New', Courier, monospace, monospace;
            font-size: ${is58 ? '10px' : '12px'};
            width: ${widthPx};
            margin: 0 auto;
            padding: 4mm 2mm;
            color: #000;
            line-height: 1.25;
            box-sizing: border-box;
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .title { font-size: ${is58 ? '13px' : '15px'}; font-weight: 900; margin-bottom: 2px; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .row { display: flex; justify-content: space-between; }
          .total-row { font-size: ${is58 ? '13px' : '15px'}; font-weight: 900; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="center">
          ${data.title ? `<div class="title">${data.title}</div>` : ''}
          ${data.subtitle ? `<div>${data.subtitle}</div>` : ''}
        </div>

        <div class="divider"></div>

        ${data.orderNumber ? `<div class="bold">ORDEN #: ${data.orderNumber}</div>` : ''}
        <div class="row">
          ${data.tableName ? `<span>Mesa: <b>${data.tableName}</b></span>` : '<span></span>'}
          ${data.waiterName ? `<span>Mesero: ${data.waiterName}</span>` : '<span></span>'}
        </div>
        ${data.date ? `<div>Fecha: ${data.date}</div>` : ''}

        <div class="divider"></div>
        ${itemsHtml}
        <div class="divider"></div>

        ${data.subtotal !== undefined ? `<div class="row"><span>Subtotal:</span><span>${data.subtotal.toLocaleString()}</span></div>` : ''}
        ${data.serviceCharge ? `<div class="row"><span>Servicio 10%:</span><span>${data.serviceCharge.toLocaleString()}</span></div>` : ''}
        ${data.tax ? `<div class="row"><span>I.V.A.:</span><span>${data.tax.toLocaleString()}</span></div>` : ''}
        
        ${data.total !== undefined ? `
          <div class="divider"></div>
          <div class="row total-row">
            <span>TOTAL:</span>
            <span>CRC ${data.total.toLocaleString()}</span>
          </div>
        ` : ''}

        ${data.fiscalConsecutive ? `
          <div class="divider"></div>
          <div class="center" style="font-size: 9px;">
            <div>Consecutivo: ${data.fiscalConsecutive}</div>
            ${data.fiscalKey ? `<div style="word-break: break-all;">Clave: ${data.fiscalKey}</div>` : ''}
          </div>
        ` : ''}

        ${data.footerNotes && data.footerNotes.length > 0 ? `
          <div class="divider"></div>
          <div class="center" style="font-size: 9px;">
            ${data.footerNotes.map(n => `<div>${n}</div>`).join('')}
          </div>
        ` : ''}
      </body>
      </html>
    `;
  }

  /**
   * Solicita una impresión mediante un iFrame invisible.
   * Devuelve true únicamente si se pudo invocar window.print(); esto no confirma
   * que el usuario haya aceptado el diálogo ni que la impresora haya procesado el ticket.
   */
  public async printSilentIframe(data: PrintReceiptData, config: PrinterConfig): Promise<boolean> {
    return new Promise((resolve) => {
      const iframeId = 'saborai_silent_print_frame';
      let iframe = document.getElementById(iframeId) as HTMLIFrameElement;

      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = iframeId;
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);
      }

      const doc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!doc) {
        resolve(false);
        return;
      }

      const html = this.generateTicketHtml(data, config);
      doc.open();
      doc.write(html);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          resolve(true);
        } catch (e) {
          console.warn('Silent print invocation error:', e);
          resolve(false);
        }
      }, 250);
    });
  }

  /**
   * Enrutamiento automático: Enviar ticket a todas las impresoras configuradas para un rol
   */
  public async printToRole(role: PrinterRole, data: PrintReceiptData): Promise<PrintResult[]> {
    const targetPrinters = this.getPrintersByRole(role);
    if (targetPrinters.length === 0) {
      // Fallback a primera impresora activa
      const anyPrinter = this.printers.find(p => p.enabled);
      if (anyPrinter) {
        const res = await this.printToConfig(anyPrinter, data);
        return [res];
      }
      return [{ success: false, error: `No hay impresoras habilitadas para el rol: ${role}` }];
    }

    const results: PrintResult[] = [];
    for (const printer of targetPrinters) {
      const res = await this.printToConfig(printer, data);
      results.push(res);
    }
    return results;
  }

  /**
   * Pulso de apertura de cajón de dinero (Cash Drawer Kick - ESC p 0 25 250)
   */
  public async openCashDrawer(): Promise<PrintResult> {
    const cashPrinters = this.getPrintersByRole('caja');
    const targetPrinters = cashPrinters.length > 0 ? cashPrinters : this.printers.filter(p => p.enabled);

    if (targetPrinters.length === 0) {
      return { success: false, error: 'No hay impresoras de caja configuradas.' };
    }

    const builder = new EscPosBuilder();
    builder.openCashDrawer();
    const rawBytes = builder.build();
    const printJobId = this.createPrintJobId();

    let anySuccess = false;
    for (const printer of targetPrinters) {
      try {
        if (printer.connectionType === 'usb') {
          const result = await this.printUsb(printer, rawBytes, { title: 'APERTURA_CAJON', items: [] });
          anySuccess = anySuccess || result.success;
        } else if (printer.connectionType === 'bluetooth') {
          const result = await this.printBluetooth(printer, rawBytes, { title: 'APERTURA_CAJON', items: [] });
          anySuccess = anySuccess || result.success;
        } else if (printer.connectionType === 'network') {
          const result = await this.printNetwork(printer, rawBytes, `${printJobId}:${printer.id}`);
          anySuccess = anySuccess || result.success;
        }
      } catch (err) {
        console.warn(`Error al abrir gaveta en "${printer.name}":`, err);
      }
    }

    return { success: anySuccess };
  }

  /**
   * Envío térmico formateado de comanda a Cocina y Bar
   */
  public async printKitchenBarOrder(order: {
    printJobId?: string;
    orderNumber: string;
    tableName: string;
    server: string;
    date?: string;
    items: Array<{ name: string; quantity: number; notes?: string; modifiers?: string[]; station?: string; category?: string }>;
  }): Promise<void> {
    const kitchenItems = order.items.filter(i => i.station === 'Cocina' || i.category === 'Cocina' || (!i.station && i.category !== 'Bar'));
    const barItems = order.items.filter(i => i.station === 'Bar' || i.category === 'Bar');
    const nowTime = order.date || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const printJobId = order.printJobId || this.createPrintJobId();

    if (kitchenItems.length > 0) {
      await this.printToRole('cocina', {
        title: '*** COMANDA COCINA ***',
        printJobId: `${printJobId}:cocina`,
        orderNumber: order.orderNumber,
        tableName: order.tableName,
        waiterName: order.server,
        date: nowTime,
        items: kitchenItems
      }).catch(err => console.warn('Error imprimiendo comanda de cocina:', err));
    }

    if (barItems.length > 0) {
      await this.printToRole('bar', {
        title: '*** COMANDA BAR ***',
        printJobId: `${printJobId}:bar`,
        orderNumber: order.orderNumber,
        tableName: order.tableName,
        waiterName: order.server,
        date: nowTime,
        items: barItems
      }).catch(err => console.warn('Error imprimiendo comanda de bar:', err));
    }
  }
}

export const printerService = new PrinterService();
