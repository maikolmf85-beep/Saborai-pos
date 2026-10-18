import { ElectronicInvoiceCR, HaciendaConfig, TenantInfo } from '../types';
import { 
  formatHaciendaDate, 
  validateInvoiceForHacienda, 
  buildClaveYConsecutivo, 
  generateHaciendaXmlV44, 
  reserveConsecutivoNumber 
} from './haciendaXml';
import { getTenantItem, setTenantItem } from './tenantStorage';

class HaciendaService {
  private invoices: ElectronicInvoiceCR[] = [];
  private listeners: ((invoices: ElectronicInvoiceCR[]) => void)[] = [];
  private config: HaciendaConfig | null = null;

  private getAuthHeaders(): Record<string, string> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  constructor() {
    // Load invoices from local storage if available
    const saved = getTenantItem<ElectronicInvoiceCR[]>('hacienda_invoices');
    if (saved) {
      try {
        this.invoices = saved.map((inv: any) => ({
          ...inv,
          fechaEmision: new Date(inv.fechaEmision)
        }));
      } catch (e) {
        console.error('Failed to load hacienda invoices', e);
      }
    }

    // Load config from local storage if available
    const savedConfig = getTenantItem<HaciendaConfig>('hacienda_config');
    if (savedConfig) {
      try {
        this.config = savedConfig;
      } catch (e) {
        console.error('Failed to load hacienda config', e);
      }
    }
  }

  public getConfig(): HaciendaConfig | null {
    if (!this.config) {
      const savedConfig = getTenantItem<HaciendaConfig>('hacienda_config');
      if (savedConfig) {
        try {
          this.config = savedConfig;
        } catch (e) {
          console.error('Failed to load hacienda config', e);
        }
      }
    }
    return this.config;
  }

  public saveConfig(config: HaciendaConfig) {
    this.config = config;
    setTenantItem('hacienda_config', config);
    // Also notify any custom event listeners
    window.dispatchEvent(new CustomEvent('saborai_hacienda_config_updated', { detail: config }));
  }

  private persist() {
    setTenantItem('hacienda_invoices', this.invoices);
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
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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

  public async voidInvoice(
    clave: string, 
    onStatusChange?: (status: string, message?: string) => void,
    tenant?: TenantInfo
  ) {
    const inv = this.invoices.find(i => i.clave50Digitos === clave);
    this.updateInvoiceStatus(clave, 'ANULADO');
    if (onStatusChange) onStatusChange('ANULADO', 'Factura marcada como anulada.');

    if (!inv) return;

    // Emisión oficial de Nota de Crédito Electrónica v4.4 a Hacienda
    const cfg = this.getConfig();
    if (cfg && (cfg.atvUsername || tenant?.haciendaConfig?.atvUsername)) {
      const activeTenant: TenantInfo = tenant || {
        id: 'current',
        name: inv.emisor.nombre,
        cedulaJuridica: inv.emisor.cedulaJuridica,
        email: inv.emisor.correo,
        phone: '50622222222',
        location: 'Costa Rica',
        plan: 'pro',
        status: 'ACTIVE',
        currency: inv.moneda,
        monthlyFee: 0,
        haciendaConfig: cfg
      };

      const branch = inv.emisor.sucursal || cfg.sucursal || '001';
      const terminal = inv.emisor.terminal || cfg.terminal || '00001';
      const ncNumero = reserveConsecutivoNumber(branch, terminal, 'NC');
      const now = new Date();
      const { clave: ncClave, consecutivo: ncConsecutivo } = buildClaveYConsecutivo({
        cedula: inv.emisor.cedulaJuridica,
        branchCode: branch,
        terminalCode: terminal,
        tipo: 'NC',
        numero: ncNumero,
        fecha: now
      });

      const notaCredito: ElectronicInvoiceCR = {
        ...inv,
        clave50Digitos: ncClave,
        consecutivo: ncConsecutivo,
        tipoDocumento: 'NC',
        fechaEmision: now.toISOString(),
        estadoHacienda: 'PROCESANDO',
        referencia: {
          clave: inv.clave50Digitos,
          fechaEmision: formatHaciendaDate(new Date(inv.fechaEmision as any)),
          tipoDoc: inv.tipoDocumento === 'FE' ? 'FE' : 'TE',
          codigo: '01',
          razon: 'Anulación de comprobante por Nota de Crédito'
        }
      };

      const ncXml = generateHaciendaXmlV44(notaCredito, activeTenant);
      notaCredito.xmlContent = ncXml;

      if (onStatusChange) onStatusChange('PROCESANDO', 'Emitiendo Nota de Crédito v4.4 a Hacienda...');
      this.emitInvoice(notaCredito, onStatusChange);
    }
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

    // Envío automático del comprobante y XML al correo del cliente mediante Resend
    if (status === 'ACEPTADO') {
      this.sendEmailNotification(clave).catch(() => {});
    }
  }

  private async sendEmailNotification(clave: string): Promise<void> {
    const inv = this.invoices.find(i => i.clave50Digitos === clave);
    if (!inv || !inv.receptor?.correo) return;

    try {
      await fetch('/api/email/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
        body: JSON.stringify({
          to: inv.receptor.correo,
          customerName: inv.receptor.nombre,
          restaurantName: inv.emisor.nombre,
          clave: inv.clave50Digitos,
          consecutivo: inv.consecutivo,
          total: inv.totalComprobante,
          docType: inv.tipoDocumento,
          xmlContent: inv.signedXmlContent || inv.xmlContent
        })
      });
      console.log(`[HaciendaService] Comprobante enviado por correo a ${inv.receptor.correo} con éxito.`);
    } catch (e) {
      console.warn('[HaciendaService] Error al enviar comprobante por correo:', e);
    }
  }
}

export const haciendaService = new HaciendaService();
