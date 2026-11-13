import type { ElectronicInvoiceCR, HaciendaConfig, TenantInfo } from '../types';
import { toFiscalInvoiceItems } from '../utils/fiscalInvoiceItems';
import {
  formatHaciendaDate,
  validateInvoiceForHacienda,
  buildClaveYConsecutivo,
  generateHaciendaXmlV44,
  reserveConsecutivoNumber
} from './haciendaXml';
import {
  clearLegacyHaciendaSecretsForTenant,
  getLegacyHaciendaConfigForTenant,
  getTenantItem,
  setTenantItem
} from './tenantStorage';

type InvoiceListener = (invoices: ElectronicInvoiceCR[]) => void;
type ConfigSaveOptions = { removeCertificate?: boolean; clearAtvCredentials?: boolean };
type PublicConfigResponse = {
  success?: boolean;
  branches?: Array<{ id: string; name: string; code: string }>;
  branch?: { id: string; name: string; code: string };
  config?: HaciendaConfig | null;
  error?: string;
  message?: string;
};

function normalizeBranchCode(value: string): string {
  const digits = String(value || '').trim();
  return /^\d{1,3}$/.test(digits) ? digits.padStart(3, '0') : '';
}

function sanitizePublicConfig(config?: HaciendaConfig | null): HaciendaConfig | null {
  if (!config) return null;
  return {
    ...config,
    atvUsername: undefined,
    atvPassword: undefined,
    pinP12: undefined,
    p12Base64: undefined
  };
}

function branchScopeKey(tenantId: string, branchCode: string): string {
  return `${tenantId}:${normalizeBranchCode(branchCode)}`;
}

class HaciendaService {
  private invoicesByTenant = new Map<string, ElectronicInvoiceCR[]>();
  private configByBranch = new Map<string, HaciendaConfig>();
  private listeners: Array<{ tenantId: string; listener: InvoiceListener }> = [];
  private activeTenantId: string | null = null;

  private getAuthHeaders(): Record<string, string> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  public setTenantContext(tenantId: string): void {
    this.activeTenantId = tenantId || null;
    if (tenantId) this.ensureInvoices(tenantId);
  }

  private ensureInvoices(tenantId: string): ElectronicInvoiceCR[] {
    const existing = this.invoicesByTenant.get(tenantId);
    if (existing) return existing;
    const saved = getTenantItem<ElectronicInvoiceCR[]>('hacienda_invoices', tenantId) || [];
    const loaded = saved.map((invoice: any) => ({
      ...invoice,
      items: toFiscalInvoiceItems(Array.isArray(invoice.items) ? invoice.items : []),
      fechaEmision: new Date(invoice.fechaEmision)
    }));
    this.invoicesByTenant.set(tenantId, loaded);
    return loaded;
  }

  public getConfig(tenantId?: string, branchCode?: string): HaciendaConfig | null {
    if (!tenantId || !branchCode) return null;
    return this.configByBranch.get(branchScopeKey(tenantId, branchCode)) || null;
  }

  public async loadConfig(tenantId: string, branchCode: string): Promise<HaciendaConfig | null> {
    if (!tenantId) throw new Error('No se pudo identificar el restaurante activo.');
    const normalizedCode = normalizeBranchCode(branchCode);
    if (!normalizedCode) throw new Error('Selecciona una sucursal válida para cargar la configuración de Hacienda.');
    const response = await fetch(`/api/hacienda?branchCode=${encodeURIComponent(normalizedCode)}`, {
      headers: this.getAuthHeaders()
    });
    const data = await response.json().catch(() => ({})) as PublicConfigResponse;
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la configuración de Hacienda.');
    const config = sanitizePublicConfig(data.config);
    if (config) this.configByBranch.set(branchScopeKey(tenantId, normalizedCode), config);
    else this.configByBranch.delete(branchScopeKey(tenantId, normalizedCode));
    return config;
  }

  public async loadConfigWithLegacyMigration(
    tenantId: string,
    branchCode: string
  ): Promise<{ config: HaciendaConfig | null; migrated: boolean; migrationError?: string }> {
    const normalizedCode = normalizeBranchCode(branchCode);
    if (!normalizedCode) throw new Error('Selecciona una sucursal válida para cargar la configuración de Hacienda.');

    const legacy = getLegacyHaciendaConfigForTenant<HaciendaConfig>(tenantId);
    const legacyBranch = normalizeBranchCode(legacy?.sucursal || normalizedCode);
    let remoteConfig: HaciendaConfig | null;
    try {
      remoteConfig = await this.loadConfig(tenantId, normalizedCode);
    } catch {
      if (legacy && legacyBranch === normalizedCode) {
        return {
          config: { ...legacy, sucursal: normalizedCode, isValidated: false },
          migrated: false,
          migrationError: 'No se pudo migrar la configuración antigua. Revisa la conexión y guarda de nuevo para cifrarla en el servidor.'
        };
      }
      throw new Error('No se pudo cargar la configuración segura de esta sucursal.');
    }

    if (remoteConfig) {
      if (legacy && legacyBranch === normalizedCode) clearLegacyHaciendaSecretsForTenant(tenantId);
      return { config: remoteConfig, migrated: false };
    }
    if (!legacy || legacyBranch !== normalizedCode) return { config: remoteConfig, migrated: false };

    const migrationDraft: HaciendaConfig = {
      ...legacy,
      sucursal: normalizedCode,
      isValidated: false,
      atvUsernameConfigured: Boolean(legacy.atvUsernameConfigured || legacy.atvUsername),
      atvPasswordConfigured: Boolean(legacy.atvPasswordConfigured || legacy.atvPassword),
      certificateConfigured: Boolean(legacy.certificateConfigured || (legacy.p12Base64 && legacy.pinP12))
    };
    try {
      const saved = await this.saveConfig(tenantId, normalizedCode, migrationDraft);
      clearLegacyHaciendaSecretsForTenant(tenantId);
      return { config: saved, migrated: true };
    } catch {
      return {
        config: migrationDraft,
        migrated: false,
        migrationError: 'No se pudo migrar la configuración antigua. Las credenciales siguen disponibles en este navegador; guarda de nuevo cuando haya conexión.'
      };
    }
  }

  public async listBranches(tenantId: string): Promise<Array<{ id: string; name: string; code: string }>> {
    if (!tenantId) throw new Error('No se pudo identificar el restaurante activo.');
    const response = await fetch('/api/hacienda', { headers: this.getAuthHeaders() });
    const data = await response.json().catch(() => ({})) as PublicConfigResponse;
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las sucursales.');
    return Array.isArray(data.branches) ? data.branches : [];
  }

  public async saveConfig(
    tenantId: string,
    branchCode: string,
    config: HaciendaConfig,
    options: ConfigSaveOptions = {}
  ): Promise<HaciendaConfig> {
    if (!tenantId) throw new Error('No se pudo identificar el restaurante activo.');
    const normalizedCode = normalizeBranchCode(branchCode);
    if (!normalizedCode) throw new Error('Selecciona una sucursal válida antes de guardar la configuración de Hacienda.');
    const response = await fetch('/api/hacienda', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: JSON.stringify({ branchCode: normalizedCode, config, ...options })
    });
    const data = await response.json().catch(() => ({})) as PublicConfigResponse;
    const safeConfig = sanitizePublicConfig(data.config);
    if (!response.ok || !safeConfig) {
      throw new Error(data.error || 'No se pudo guardar la configuración segura de Hacienda.');
    }
    this.configByBranch.set(branchScopeKey(tenantId, normalizedCode), safeConfig);
    // Tras confirmar el almacenamiento cifrado del servidor, eliminar la copia
    // local antigua que podía contener contraseña, PIN y certificado en claro.
    clearLegacyHaciendaSecretsForTenant(tenantId);
    window.dispatchEvent(new CustomEvent('saborai_hacienda_config_updated', {
      detail: { tenantId, branchCode: normalizedCode, config: safeConfig }
    }));
    return safeConfig;
  }

  public async testConnection(
    tenantId: string,
    branchCode: string,
    configToSave?: HaciendaConfig,
    options: ConfigSaveOptions = {}
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      if (!tenantId) return { success: false, message: 'No se pudo identificar el restaurante activo.' };
      const normalizedCode = normalizeBranchCode(branchCode);
      if (!normalizedCode) return { success: false, message: 'Selecciona una sucursal válida antes de probar la conexión.' };
      const response = await fetch('/api/hacienda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
        body: JSON.stringify({
          action: 'test-connection',
          branchCode: normalizedCode,
          config: configToSave,
          ...options
        })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success) {
        const safeConfig = sanitizePublicConfig(data.config);
        if (safeConfig) {
          const key = branchScopeKey(tenantId, normalizedCode);
          this.configByBranch.set(key, safeConfig);
          clearLegacyHaciendaSecretsForTenant(tenantId);
          window.dispatchEvent(new CustomEvent('saborai_hacienda_config_updated', {
            detail: { tenantId, branchCode: normalizedCode, config: safeConfig }
          }));
        }
        const details = {
          environment: data.environment === 'production' ? 'production' : data.environment === 'sandbox' ? 'sandbox' : undefined,
          tokenOk: data.tokenOk === true,
          certOk: data.certOk === true,
          expiresOn: typeof data.expiresOn === 'string' ? data.expiresOn.slice(0, 40) : undefined
        };
        return { success: true, message: data.message || 'Conexión exitosa con Hacienda ATV.', details };
      }
      return { success: false, message: data?.error || 'No se pudo validar la conexión con Hacienda.' };
    } catch (error: any) {
      return { success: false, message: error?.message || 'No se pudo comunicar con el servidor de Hacienda.' };
    }
  }

  private persist(tenantId: string): void {
    const invoices = this.ensureInvoices(tenantId);
    setTenantItem('hacienda_invoices', invoices, tenantId);
    const snapshot = [...invoices];
    this.listeners.filter(entry => entry.tenantId === tenantId).forEach(entry => entry.listener(snapshot));
  }

  public subscribe(listener: InvoiceListener, tenantId = this.activeTenantId || ''): () => void {
    if (!tenantId) return () => undefined;
    const entry = { tenantId, listener };
    this.listeners.push(entry);
    listener([...this.ensureInvoices(tenantId)]);
    return () => { this.listeners = this.listeners.filter(item => item !== entry); };
  }

  public getInvoices(tenantId = this.activeTenantId || ''): ElectronicInvoiceCR[] {
    if (!tenantId) return [];
    return [...this.ensureInvoices(tenantId)];
  }

  public async refreshFromServer(tenantId = this.activeTenantId || ''): Promise<void> {
    if (!tenantId) return;
    try {
      const response = await fetch('/api/hacienda-history?limit=250', {
        headers: this.getAuthHeaders()
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.invoices)) return;

      const remoteInvoices: ElectronicInvoiceCR[] = data.invoices.map((row: any) => {
        const source = row.invoiceData || {};
        const status = row.status === 'ACCEPTED'
          ? 'ACEPTADO'
          : row.status === 'REJECTED'
            ? 'RECHAZADO'
            : row.status === 'VOIDED'
              ? 'ANULADO'
              : 'PROCESANDO';
        return {
          ...source,
          clave50Digitos: row.clave,
          consecutivo: row.consecutivo,
          tipoDocumento: source.documentType || row.documentType || 'TE',
          emisor: source.emisor || { nombre: '', cedulaJuridica: '', nombreComercial: '', correo: '', sucursal: '', terminal: '' },
          receptor: source.receptor || { nombre: 'Cliente General Contado', tipoIdentificacion: '01-Fisica', identificacion: '', correo: '' },
          fechaEmision: source.fechaEmision || row.createdAt,
          moneda: source.moneda || 'CRC',
          tipoCambio: Number(source.tipoCambio || 1),
          items: toFiscalInvoiceItems(Array.isArray(source.items) ? source.items : []),
          subtotal: Number(source.subtotal || row.total || 0),
          iva13: Number(source.iva13 || 0),
          iva4: Number(source.iva4 || 0),
          iva2: Number(source.iva2 || 0),
          iva1: Number(source.iva1 || 0),
          servicio10: Number(source.servicio10 || 0),
          totalComprobante: Number(source.total || row.total || 0),
          estadoHacienda: status,
          xmlContent: row.xmlContent || source.xmlContent,
          signedXmlContent: row.signedXmlContent || source.signedXmlContent,
          errorMensaje: row.errorMessage
        } as ElectronicInvoiceCR;
      });

      const invoices = this.ensureInvoices(tenantId);
      const remoteKeys = new Set(remoteInvoices.map(invoice => invoice.clave50Digitos));
      this.invoicesByTenant.set(tenantId, [
        ...remoteInvoices,
        ...invoices.filter(invoice => !remoteKeys.has(invoice.clave50Digitos))
      ]);
      this.persist(tenantId);
    } catch {
      console.warn('[Hacienda] No se pudo actualizar el historial remoto.');
    }
  }

  public async emitInvoice(
    invoice: ElectronicInvoiceCR,
    onStatusChange?: (status: string, message?: string) => void,
    overrideConfig?: HaciendaConfig,
    tenantId = this.activeTenantId || '',
    requestAction: 'emit' | 'resend' = 'emit'
  ): Promise<void> {
    if (!tenantId) {
      onStatusChange?.('ERROR_LOCAL', 'No se pudo identificar el restaurante para emitir el comprobante.');
      return;
    }

    const fiscalItems = toFiscalInvoiceItems(invoice.items);
    const fiscalInvoice = { ...invoice, items: fiscalItems };
    const invoices = this.ensureInvoices(tenantId);
    const newInvoice: ElectronicInvoiceCR = {
      ...fiscalInvoice,
      estadoHacienda: 'PROCESANDO',
      errorMensaje: undefined
    };
    this.invoicesByTenant.set(tenantId, [newInvoice, ...invoices.filter(item => item.clave50Digitos !== invoice.clave50Digitos)]);
    this.persist(tenantId);

    const branchCode = normalizeBranchCode(invoice.emisor?.sucursal || '');
    if (!/^\d{3}$/.test(branchCode)) {
      const reason = 'La venta no tiene una sucursal válida asignada.';
      this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ERROR_LOCAL', undefined, reason);
      onStatusChange?.('ERROR_LOCAL', reason);
      return;
    }

    const config = overrideConfig
      || this.getConfig(tenantId, branchCode)
      || await this.loadConfig(tenantId, branchCode).catch(() => null);
    if (!config?.isValidated || !config.atvUsernameConfigured || !config.atvPasswordConfigured || !config.certificateConfigured) {
      const reason = 'La sucursal no tiene un perfil de Hacienda completo y validado.';
      this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ERROR_LOCAL', undefined, reason);
      onStatusChange?.('ERROR_LOCAL', reason);
      return;
    }

    const preflightError = validateInvoiceForHacienda(fiscalInvoice, undefined, config);
    if (preflightError) {
      this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ERROR_LOCAL', undefined, preflightError);
      onStatusChange?.('ERROR_LOCAL', preflightError);
      return;
    }
    if (!invoice.xmlContent?.trim()) {
      const reason = 'No se generó el XML fiscal para este comprobante.';
      this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ERROR_LOCAL', undefined, reason);
      onStatusChange?.('ERROR_LOCAL', reason);
      return;
    }

    onStatusChange?.('PROCESANDO', 'Firmando XML y transmitiendo a Hacienda CR...');
    const invoiceDate = new Date(invoice.fechaEmision as any);
    const fechaIso = isNaN(invoiceDate.getTime()) ? undefined : formatHaciendaDate(invoiceDate);
    try {
      const response = await fetch('/api/hacienda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
        body: JSON.stringify({
          action: requestAction,
          branchCode,
          xmlString: invoice.xmlContent,
          clave: invoice.clave50Digitos,
          consecutivo: invoice.consecutivo,
          documentType: invoice.tipoDocumento || 'TE',
          total: invoice.totalComprobante,
          fecha: fechaIso,
          emisor: { ...invoice.emisor, sucursal: branchCode, tipoIdentificacion: config.tipoIdentificacion || '02' },
          receptor: invoice.tipoDocumento === 'TE' ? undefined : invoice.receptor,
          codigoActividadReceptor: invoice.codigoActividadReceptor,
          condicionVenta: invoice.condicionVenta,
          medioPago: invoice.medioPago,
          moneda: invoice.moneda,
          tipoCambio: invoice.tipoCambio,
          pagos: invoice.pagos,
          items: fiscalItems,
          subtotal: invoice.subtotal,
          iva13: invoice.iva13,
          iva4: invoice.iva4,
          iva2: invoice.iva2,
          iva1: invoice.iva1,
          servicio10: invoice.servicio10
        })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success === true && data?.estado === 'ACEPTADO') {
        this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ACEPTADO', data.signedXmlBase64);
        onStatusChange?.('ACEPTADO', data.mensaje || 'Comprobante aceptado por Hacienda.');
      } else if (response.ok && data?.success === true) {
        this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'PROCESANDO', data.signedXmlBase64);
        onStatusChange?.('PROCESANDO', 'Recibido por Hacienda. Esperando validación...');
        this.pollStatus(tenantId, invoice.clave50Digitos, branchCode, onStatusChange);
      } else if (
        (response.status >= 400 && response.status < 500 && !['STATUS_QUERY_REQUIRED', 'RESEND_ALREADY_CLAIMED'].includes(data?.code)) ||
        (data?.code === 'NOT_SUBMITTED' && data?.submitted === false)
      ) {
        const reason = typeof data?.error === 'string'
          ? data.error.slice(0, 600)
          : 'El comprobante no se transmitió. Corrija el problema indicado antes de volver a intentar.';
        this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'ERROR_LOCAL', undefined, reason);
        onStatusChange?.('ERROR_LOCAL', reason);
      } else {
        const reason = typeof data?.error === 'string' && ['STATUS_QUERY_REQUIRED', 'RESEND_ALREADY_CLAIMED'].includes(data?.code)
          ? `${data.error} Se consultará la clave antes de cualquier reenvío.`
          : 'No se confirmó la recepción del comprobante. Se consultará su estado por clave; no lo reenvíe mientras siga pendiente.';
        this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'PROCESANDO', undefined, reason);
        onStatusChange?.('INCIERTO', reason);
        this.pollStatus(tenantId, invoice.clave50Digitos, branchCode, onStatusChange);
      }
    } catch {
      const reason = 'Se perdió la respuesta de emisión. Se consultará el estado por clave; no lo reenvíe mientras siga pendiente.';
      this.updateInvoiceStatus(tenantId, invoice.clave50Digitos, 'PROCESANDO', undefined, reason);
      onStatusChange?.('INCIERTO', reason);
      this.pollStatus(tenantId, invoice.clave50Digitos, branchCode, onStatusChange);
    }
  }

  private pollStatus(
    tenantId: string,
    clave: string,
    branchCode: string,
    onStatusChange?: (status: string, message?: string) => void,
    attempt = 1
  ): void {
    const maxAttempts = 12;
    setTimeout(async () => {
      try {
        const response = await fetch('/api/hacienda', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
          body: JSON.stringify({ action: 'consultar-estado', clave, branchCode })
        });
        const data = await response.json().catch(() => null);
        const status: string | undefined = response.ok && data?.success === true ? data?.estado : undefined;
        if (status === 'aceptado') {
          this.updateInvoiceStatus(tenantId, clave, 'ACEPTADO');
          onStatusChange?.('ACEPTADO', data?.detalle || 'Comprobante aceptado por Hacienda.');
          return;
        }
        if (status === 'rechazado') {
          const reason = data?.detalle || 'Comprobante rechazado por Hacienda (sin detalle).';
          this.updateInvoiceStatus(tenantId, clave, 'RECHAZADO', undefined, reason);
          onStatusChange?.('RECHAZADO', reason);
          console.warn('[Hacienda] Un comprobante fue rechazado.');
          return;
        }
      } catch {
        console.warn('[Hacienda] No se pudo consultar el estado; se reintentará.');
      }

      if (attempt < maxAttempts) this.pollStatus(tenantId, clave, branchCode, onStatusChange, attempt + 1);
      else onStatusChange?.('PROCESANDO', 'Hacienda aún está procesando el comprobante. Revise el historial más tarde.');
    }, attempt === 1 ? 2500 : 5000);
  }

  public reconcileInvoiceStatus(
    tenantId: string,
    clave: string,
    branchCode: string,
    onStatusChange?: (status: string, message?: string) => void,
    initialMessage = 'No se confirmó el resultado fiscal. Se consultará el estado por clave; no reenvíe el comprobante mientras siga pendiente.'
  ): void {
    const normalizedBranchCode = normalizeBranchCode(branchCode || '');
    if (!tenantId || !/^\d{50}$/.test(clave) || !/^\d{3}$/.test(normalizedBranchCode)) {
      onStatusChange?.('PROCESANDO', initialMessage);
      return;
    }
    this.updateInvoiceStatus(tenantId, clave, 'PROCESANDO', undefined, initialMessage);
    this.pollStatus(tenantId, clave, normalizedBranchCode, onStatusChange);
  }

  public resendInvoice(
    clave: string,
    onStatusChange?: (status: string, message?: string) => void,
    tenantId = this.activeTenantId || ''
  ): void {
    if (!tenantId) return;
    const invoice = this.ensureInvoices(tenantId).find(item => item.clave50Digitos === clave);
    if (!invoice || invoice.estadoHacienda !== 'RECHAZADO') {
      onStatusChange?.(invoice?.estadoHacienda === 'ACEPTADO' ? 'ACEPTADO' : 'PROCESANDO',
        'No se reenvió: solo se permite reintentar un rechazo confirmado por Hacienda.');
      return;
    }
    this.updateInvoiceStatus(tenantId, clave, 'PROCESANDO');
    void this.emitInvoice(invoice, onStatusChange, undefined, tenantId, 'resend').catch(() => {
      this.reconcileInvoiceStatus(tenantId, clave, invoice.emisor?.sucursal || '', onStatusChange);
    });
  }

  public async voidInvoice(
    clave: string,
    onStatusChange?: (status: string, message?: string) => void,
    tenant?: TenantInfo
  ): Promise<void> {
    const tenantId = tenant?.id || this.activeTenantId || '';
    if (!tenantId) return;
    const invoice = this.ensureInvoices(tenantId).find(item => item.clave50Digitos === clave);
    if (!invoice) return;

    const branchCode = normalizeBranchCode(invoice.emisor.sucursal || '');
    const config = await this.loadConfig(tenantId, branchCode).catch(() => null);
    if (!config?.atvUsernameConfigured || !config.certificateConfigured) {
      onStatusChange?.('RECHAZADO', 'No hay una configuración de Hacienda completa para la sucursal de este comprobante.');
      return;
    }

    const activeTenant: TenantInfo = tenant || {
      id: tenantId,
      name: invoice.emisor.nombre,
      cedulaJuridica: invoice.emisor.cedulaJuridica,
      email: invoice.emisor.correo,
      phone: '',
      location: config.otrasSenas || '',
      plan: 'pro',
      status: 'ACTIVE',
      currency: invoice.moneda,
      monthlyFee: 0,
      haciendaConfig: config
    };
    const branch = branchCode || config.sucursal || '001';
    const terminal = invoice.emisor.terminal || config.terminal || '00001';
    const number = reserveConsecutivoNumber(branch, terminal, 'NC');
    const now = new Date();
    const { clave: ncClave, consecutivo: ncConsecutivo } = buildClaveYConsecutivo({
      cedula: config.cedulaEmisor || invoice.emisor.cedulaJuridica,
      branchCode: branch,
      terminalCode: terminal,
      tipo: 'NC',
      numero: number,
      fecha: now
    });
    const notaCredito: ElectronicInvoiceCR = {
      ...invoice,
      clave50Digitos: ncClave,
      consecutivo: ncConsecutivo,
      tipoDocumento: 'NC',
      fechaEmision: now.toISOString(),
      estadoHacienda: 'PROCESANDO',
      referencia: {
        clave: invoice.clave50Digitos,
        fechaEmision: formatHaciendaDate(new Date(invoice.fechaEmision as any)),
        tipoDoc: invoice.tipoDocumento === 'FE' ? 'FE' : 'TE',
        codigo: '01',
        razon: 'Anulación de comprobante por Nota de Crédito'
      }
    };
    notaCredito.xmlContent = generateHaciendaXmlV44(notaCredito, activeTenant, config);
    onStatusChange?.('PROCESANDO', 'Emitiendo Nota de Crédito a Hacienda...');
    this.emitInvoice(notaCredito, onStatusChange, config, tenantId);
  }

  private updateInvoiceStatus(
    tenantId: string,
    clave: string,
    status: 'ACEPTADO' | 'PROCESANDO' | 'RECHAZADO' | 'ERROR_LOCAL' | 'ANULADO',
    signedXmlBase64?: string,
    errorMensaje?: string
  ): void {
    const invoices = this.ensureInvoices(tenantId).map(invoice => {
      if (invoice.clave50Digitos !== clave) return invoice;
      let signedXmlContent = invoice.signedXmlContent;
      if (signedXmlBase64) {
        try { signedXmlContent = decodeURIComponent(escape(atob(signedXmlBase64))); } catch { /* conservar el anterior */ }
      }
      return {
        ...invoice,
        estadoHacienda: status,
        signedXmlContent,
        errorMensaje: status === 'RECHAZADO' || status === 'ERROR_LOCAL' || status === 'PROCESANDO' ? (errorMensaje || undefined) : undefined
      };
    });
    this.invoicesByTenant.set(tenantId, invoices);
    this.persist(tenantId);
    if (status === 'ACEPTADO') this.sendEmailNotification(tenantId, clave).catch(() => undefined);
  }

  private async sendEmailNotification(tenantId: string, clave: string): Promise<void> {
    const invoice = this.ensureInvoices(tenantId).find(item => item.clave50Digitos === clave);
    if (!invoice || !invoice.receptor?.correo) return;
    try {
      await fetch('/api/email/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
        body: JSON.stringify({
          to: invoice.receptor.correo,
          customerName: invoice.receptor.nombre,
          restaurantName: invoice.emisor.nombre,
          clave: invoice.clave50Digitos,
          consecutivo: invoice.consecutivo,
          total: invoice.totalComprobante,
          docType: invoice.tipoDocumento,
          xmlContent: invoice.signedXmlContent || invoice.xmlContent
        })
      });
    } catch {
      console.warn('[Hacienda] No se pudo enviar el comprobante por correo.');
    }
  }
}

export const haciendaService = new HaciendaService();
