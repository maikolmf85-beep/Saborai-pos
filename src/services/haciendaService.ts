import { ElectronicInvoiceCR, HaciendaConfig } from '../types';
import { formatHaciendaDate, validateInvoiceForHacienda } from './haciendaXml';

class HaciendaService {
  private invoices: ElectronicInvoiceCR[] = [];
  private listeners: ((invoices: ElectronicInvoiceCR[]) => void)[] = [];
  private config: HaciendaConfig | null = null;

  constructor() {
    // Load invoices from local storage if available
    const saved = localStorage.getItem('saborai_hacienda_invoices');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.invoices = parsed.map((inv: any) => ({
          ...inv,
          fechaEmision: new Date(inv.fechaEmision)
        }));
      } catch (e) {
        console.error('Failed to load hacienda invoices', e);
      }
    }

    // Load config from local storage if available
    const savedConfig = localStorage.getItem('saborai_hacienda_config');
    if (savedConfig) {
      try {
        this.config = JSON.parse(savedConfig);
      } catch (e) {
        console.error('Failed to load hacienda config', e);
      }
    }
  }

  public getConfig(): HaciendaConfig | null {
    if (!this.config) {
      const savedConfig = localStorage.getItem('saborai_hacienda_config');
      if (savedConfig) {
        try {
          this.config = JSON.parse(savedConfig);
        } catch (e) {
          console.error('Failed to load hacienda config', e);
        }
      }
    }
    return this.config;
  }

  public saveConfig(config: HaciendaConfig) {
    this.config = config;
    localStorage.setItem('saborai_hacienda_config', JSON.stringify(config));
    // Also notify any custom event listeners
    window.dispatchEvent(new CustomEvent('saborai_hacienda_config_updated', { detail: config }));
  }

  private persist() {
    localStorage.setItem('saborai_hacienda_invoices', JSON.stringify(this.invoices));
    this.notifyListeners();
  }

  public subscribe(listener: (invoices: ElectronicInvoiceCR[]) => void) {
    this.listeners.push(listener);
    listener(this.invoices);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.invoices]));
  }

  public getInvoices(): ElectronicInvoiceCR[] {
    return [...this.invoices];
  }

  public async testConnection(configToTest?: HaciendaConfig): Promise<{ success: boolean; message: string; details?: any }> {
    const config = configToTest || this.getConfig();
    if (!config?.atvUsername || !config?.atvPassword) {
      return { success: false, message: 'Faltan credenciales ATV (usuario o contraseña).' };
    }

    try {
      const res = await fetch('/api/hacienda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test-connection',
          atvUsername: config.atvUsername,
          atvPassword: config.atvPassword,
          p12Base64: config.p12Base64,
          p12Pin: config.pinP12,
          environment: config.environment || 'sandbox'
        })
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        // Guardar configuración completa actualizada
        const updatedConfig: HaciendaConfig = {
          ...config,
          isValidated: true,
          certExpiresOn: data.expiresOn || config.certExpiresOn,
          lastTestedAt: new Date().toISOString()
        };
        this.saveConfig(updatedConfig);
        return { success: true, message: data.message || 'Conexión exitosa con Hacienda ATV.', details: data };
      } else {
        return { 
          success: false, 
          message: data?.error || data?.message || 'Error al conectar con Hacienda ATV.', 
          details: data 
        };
      }
    } catch (err: any) {
      return { success: false, message: `Error de red: ${err.message}` };
    }
  }

  public emitInvoice(
    invoice: ElectronicInvoiceCR, 
    onStatusChange?: (status: string, message?: string) => void,
    overrideConfig?: HaciendaConfig
  ) {
    const activeConfig = overrideConfig || this.getConfig();

    // Save invoice as processing initially
    const newInvoice: ElectronicInvoiceCR = {
      ...invoice,
      estadoHacienda: 'PROCESANDO',
      errorMensaje: undefined
    };
    
    this.invoices = [newInvoice, ...this.invoices.filter(i => i.clave50Digitos !== invoice.clave50Digitos)];
    this.persist();

    // Validación previa: evita enviar comprobantes que Hacienda rechazará seguro
    const preflightError = validateInvoiceForHacienda(invoice);
    if (preflightError) {
      this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO', undefined, preflightError);
      if (onStatusChange) onStatusChange('RECHAZADO', preflightError);
      return;
    }

    if (onStatusChange) onStatusChange('PROCESANDO', 'Firmando XML con XAdES-EPES y transmitiendo a Hacienda CR...');

    const credentials = {
      atvUsername: activeConfig?.atvUsername,
      atvPassword: activeConfig?.atvPassword,
      p12Base64: activeConfig?.p12Base64,
      p12Pin: activeConfig?.pinP12,
      environment: activeConfig?.environment || 'sandbox'
    };

    const fechaIso = formatHaciendaDate(new Date(invoice.fechaEmision as any));

    // Call backend API
    fetch('/api/hacienda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'emit',
        xmlString: invoice.xmlContent || '',
        clave: invoice.clave50Digitos,
        fecha: isNaN(new Date(invoice.fechaEmision as any).getTime()) ? undefined : fechaIso,
        emisor: { ...invoice.emisor, tipoIdentificacion: activeConfig?.tipoIdentificacion || '02' },
        receptor: invoice.tipoDocumento === 'TE' ? undefined : invoice.receptor,
        ...credentials
      })
    })
    .then(async res => {
      const data = await res.json().catch(() => null);
      return data || { success: false, error: `Respuesta inválida del servidor (HTTP ${res.status})` };
    })
    .then(data => {
      if (data.success) {
        // 202: Hacienda recibió el comprobante; la validación es asíncrona. Consultamos el resultado real.
        this.updateInvoiceStatus(invoice.clave50Digitos, 'PROCESANDO', data.signedXmlBase64);
        if (onStatusChange) onStatusChange('PROCESANDO', 'Recibido por Hacienda. Esperando validación...');
        this.pollStatus(invoice.clave50Digitos, credentials, onStatusChange);
      } else {
        const reason = data.error || data.message || 'Rechazado por Hacienda.';
        this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO', data.signedXmlBase64, reason);
        if (onStatusChange) onStatusChange('RECHAZADO', reason);
        console.error('Hacienda API Error:', data);
      }
    })
    .catch(err => {
      console.error('Hacienda Network Error:', err);
      const reason = `Error de conexión: ${err.message}`;
      this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO', undefined, reason);
      if (onStatusChange) onStatusChange('RECHAZADO', reason);
    });
  }

  private pollStatus(
    clave: string,
    credentials: Record<string, any>,
    onStatusChange?: (status: string, message?: string) => void,
    attempt = 1
  ) {
    const MAX_ATTEMPTS = 12;
    setTimeout(async () => {
      try {
        const res = await fetch('/api/hacienda', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'consultar-estado', clave, ...credentials })
        });
        const data = await res.json().catch(() => null);
        const estado: string | undefined = data?.estado;

        if (estado === 'aceptado') {
          this.updateInvoiceStatus(clave, 'ACEPTADO');
          if (onStatusChange) onStatusChange('ACEPTADO', data?.detalle || 'Comprobante aceptado por Hacienda.');
          return;
        }
        if (estado === 'rechazado') {
          const reason = data?.detalle || 'Comprobante rechazado por Hacienda (sin detalle).';
          this.updateInvoiceStatus(clave, 'RECHAZADO', undefined, reason);
          if (onStatusChange) onStatusChange('RECHAZADO', reason);
          console.error('Hacienda rechazó el comprobante:', data);
          return;
        }
      } catch (err) {
        console.warn('Consulta de estado falló, reintentando...', err);
      }

      if (attempt < MAX_ATTEMPTS) {
        this.pollStatus(clave, credentials, onStatusChange, attempt + 1);
      } else if (onStatusChange) {
        onStatusChange('PROCESANDO', 'Hacienda aún está procesando el comprobante. Revise el historial más tarde.');
      }
    }, attempt === 1 ? 2500 : 5000);
  }

  public resendInvoice(clave: string, onStatusChange?: (status: string, message?: string) => void) {
    this.updateInvoiceStatus(clave, 'PROCESANDO');
    if (onStatusChange) onStatusChange('PROCESANDO');

    const inv = this.invoices.find(i => i.clave50Digitos === clave);
    if (inv) {
      this.emitInvoice(inv, onStatusChange);
    }
  }

  public voidInvoice(clave: string, onStatusChange?: (status: string) => void) {
    // Aquí en un sistema real se enviaría una Nota de Crédito a Hacienda
    this.updateInvoiceStatus(clave, 'ANULADO');
    if (onStatusChange) onStatusChange('ANULADO');
  }

  private updateInvoiceStatus(
    clave: string, 
    status: 'ACEPTADO' | 'PROCESANDO' | 'RECHAZADO' | 'ANULADO',
    signedXmlBase64?: string,
    errorMensaje?: string
  ) {
    this.invoices = this.invoices.map(inv => {
      if (inv.clave50Digitos === clave) {
        let signedXmlContent = inv.signedXmlContent;
        if (signedXmlBase64) {
          try { signedXmlContent = decodeURIComponent(escape(atob(signedXmlBase64))); } catch { /* keep previous */ }
        }
        return { 
          ...inv, 
          estadoHacienda: status,
          signedXmlContent,
          errorMensaje: status === 'RECHAZADO' ? (errorMensaje || inv.errorMensaje) : undefined
        };
      }
      return inv;
    });
    this.persist();
  }
}

export const haciendaService = new HaciendaService();
