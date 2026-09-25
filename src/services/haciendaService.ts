import { ElectronicInvoiceCR, HaciendaConfig } from '../types';

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
    const activeConfig = overrideConfig || this.config;

    // Save invoice as processing initially
    const newInvoice: ElectronicInvoiceCR = {
      ...invoice,
      estadoHacienda: 'PROCESANDO'
    };
    
    this.invoices = [newInvoice, ...this.invoices];
    this.persist();

    if (onStatusChange) onStatusChange('PROCESANDO', 'Firmando XML con XAdES-EPES y transmitiendo a Hacienda CR...');

    // Call backend API
    fetch('/api/hacienda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'emit',
        xmlString: invoice.xmlContent || '',
        clave: invoice.clave50Digitos,
        fecha: invoice.fechaEmision,
        emisor: invoice.emisor,
        receptor: invoice.receptor,
        atvUsername: activeConfig?.atvUsername,
        atvPassword: activeConfig?.atvPassword,
        p12Base64: activeConfig?.p12Base64,
        p12Pin: activeConfig?.pinP12,
        environment: activeConfig?.environment || 'sandbox'
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        this.updateInvoiceStatus(invoice.clave50Digitos, 'ACEPTADO', data.signedXmlBase64);
        if (onStatusChange) onStatusChange('ACEPTADO', data.mensaje || 'Comprobante recibido por Hacienda.');
      } else {
        this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO');
        if (onStatusChange) onStatusChange('RECHAZADO', data.error || 'Rechazado por Hacienda.');
        console.error('Hacienda API Error:', data);
      }
    })
    .catch(err => {
      console.error('Hacienda Network Error:', err);
      this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO');
      if (onStatusChange) onStatusChange('RECHAZADO', `Error de conexión: ${err.message}`);
    });
  }

  public resendInvoice(clave: string, onStatusChange?: (status: string) => void) {
    this.updateInvoiceStatus(clave, 'PROCESANDO');
    if (onStatusChange) onStatusChange('PROCESANDO');

    const inv = this.invoices.find(i => i.clave50Digitos === clave);
    if (inv) {
      this.emitInvoice(inv, onStatusChange);
    }
  }

  private updateInvoiceStatus(
    clave: string, 
    status: 'ACEPTADO' | 'PROCESANDO' | 'RECHAZADO',
    signedXmlBase64?: string
  ) {
    this.invoices = this.invoices.map(inv => {
      if (inv.clave50Digitos === clave) {
        return { 
          ...inv, 
          estadoHacienda: status,
          xmlContent: signedXmlBase64 ? atob(signedXmlBase64) : inv.xmlContent
        };
      }
      return inv;
    });
    this.persist();
  }
}

export const haciendaService = new HaciendaService();
