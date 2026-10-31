import { printerService } from './printerService';
import { haciendaService } from './haciendaService';
import { localDB } from './db';
import { nyzaLearningService } from './nyzaLearningService';

export interface NyzaToolResult {
  tool: string;
  status: 'OK' | 'ERROR';
  message: string;
  timestamp: string;
  data?: any;
}

export interface NyzaExecutionResponse {
  thought: string;
  tool_calls: Array<{
    name: string;
    parameters: Record<string, any>;
  }>;
  finalMessage?: string;
}

/**
 * Catálogo de Herramientas de Autodiagnóstico y Self-Healing de Nyza
 */
export class NyzaSelfHealingService {
  private static instance: NyzaSelfHealingService;

  public static getInstance(): NyzaSelfHealingService {
    if (!NyzaSelfHealingService.instance) {
      NyzaSelfHealingService.instance = new NyzaSelfHealingService();
    }
    return NyzaSelfHealingService.instance;
  }

  // ----------------------------------------------------
  // HERRAMIENTAS DE RED E IMPRESIÓN
  // ----------------------------------------------------

  /** El navegador no tiene permiso fiable para confirmar reachability de impresoras LAN. */
  public async tool_ping_device(ip: string): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    const privateAddress = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|127\.0\.0\.1|localhost)$/.test(ip);
    if (!privateAddress) {
      return { tool: 'tool_ping_device', status: 'ERROR', message: 'Solo se aceptan direcciones locales privadas; no se hizo ninguna solicitud de red.', timestamp };
    }
    const configured = printerService.getPrinters().some(printer => printer.ipAddress === ip && printer.enabled);
    return {
      tool: 'tool_ping_device',
      status: 'ERROR',
      message: configured
        ? `Hay una impresora habilitada configurada en ${ip}, pero el navegador no puede confirmar si responde.`
        : `No encontré una impresora habilitada configurada en ${ip}; no hice ninguna solicitud de red.`,
      timestamp,
      data: { ip, configurationFound: configured, connectivityVerified: false }
    };
  }

  /**
   * tool_restart_spooler(): Reinicia el servicio local de impresión y purga la cola colgada
   */
  public async tool_restart_spooler(): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    try {
      // 1. Limpiar iframes de impresión colgados en el DOM
      const frames = document.querySelectorAll('iframe[id*="print"]');
      frames.forEach(f => f.remove());

      // 2. Recargar configuración de impresoras activas
      printerService.loadPrinters();

      // 3. Notificar al sistema local de impresión
      return {
        tool: 'tool_restart_spooler',
        status: 'OK',
        message: 'Se recargó la configuración de impresoras y se retiraron marcos de impresión del navegador. No se reinició un servicio de impresión del sistema.',
        timestamp
      };
    } catch (err: any) {
      return {
        tool: 'tool_restart_spooler',
        status: 'ERROR',
        message: `Error al reiniciar spooler: ${err.message}`,
        timestamp
      };
    }
  }

  /**
   * tool_reroute_printer(failed_ip: string, backup_ip: string): Redirige comandas de un área caída
   */
  public async tool_reroute_printer(failed_ip: string, backup_ip: string, isTenantActive: () => boolean): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    try {
      if (!isTenantActive()) {
        return { tool: 'tool_reroute_printer', status: 'ERROR', message: 'No se cambió ninguna impresora: el restaurante de la aprobación ya no está activo.', timestamp, data: { changed: false } };
      }
      const printers = printerService.getPrinters();
      const failedMatches = printers.filter(p => p.ipAddress === failed_ip || p.name.toLowerCase() === failed_ip.toLowerCase());
      const backupMatches = printers.filter(p => p.ipAddress === backup_ip || p.name.toLowerCase() === backup_ip.toLowerCase());
      const failed = failedMatches.length === 1 ? failedMatches[0] : undefined;
      const backup = backupMatches.length === 1 ? backupMatches[0] : undefined;

      if (failed && backup && failed.id !== backup.id && backup.enabled) {
        if (!isTenantActive()) {
          return { tool: 'tool_reroute_printer', status: 'ERROR', message: 'No se cambió ninguna impresora: el restaurante de la aprobación ya no está activo.', timestamp, data: { changed: false } };
        }
        failed.ipAddress = backup.ipAddress;
        failed.port = backup.port;
        failed.connectionType = backup.connectionType;
        printerService.savePrinter(failed);
        return {
          tool: 'tool_reroute_printer',
          status: 'OK',
          message: `Impresora ${failed.name} redirigida exitosamente a ${backup.name} (${backup.ipAddress || 'Activa'}).`,
          timestamp
        };
      }

      return {
        tool: 'tool_reroute_printer',
        status: 'ERROR',
        message: 'No se cambió el enrutamiento: especifica una impresora origen y otra impresora de respaldo habilitada.',
        timestamp
      };
    } catch (err: any) {
      return {
        tool: 'tool_reroute_printer',
        status: 'ERROR',
        message: `Fallo al redirigir impresora: ${err.message}`,
        timestamp
      };
    }
  }

  // ----------------------------------------------------
  // HERRAMIENTAS DE BASE DE DATOS Y MEMORIA
  // ----------------------------------------------------

  /**
   * tool_db_integrity_check(): Diagnóstico de almacenamiento local IndexedDB / SQLite
   */
  public async tool_db_integrity_check(tenantId: string): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    try {
      await localDB.init();
      const queue = await localDB.getPendingItems(tenantId);
      return {
        tool: 'tool_db_integrity_check',
        status: 'OK',
        message: `La cola local del restaurante activo se pudo leer y contiene ${queue.length} elemento(s) pendiente(s). Esto no comprueba la integridad total de la base ni la sincronización remota.`,
        timestamp,
        data: { localQueueReadable: true, pendingCount: queue.length, tenantScoped: true, fullIntegrityVerified: false }
      };
    } catch (err: any) {
      return {
        tool: 'tool_db_integrity_check',
        status: 'ERROR',
        message: `Error de integridad en DB local: ${err.message}`,
        timestamp
      };
    }
  }

  /** IndexedDB no ofrece VACUUM aquí; se informa la limitación sin borrar datos. */
  public async tool_db_vacuum_and_repair(): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    return {
      tool: 'tool_db_vacuum_and_repair',
      status: 'ERROR',
      message: 'No se ejecutó ninguna reparación ni se borraron datos: esta interfaz no implementa una operación segura de VACUUM para IndexedDB.',
      timestamp,
      data: { changed: false }
    };
  }

  /** Los navegadores no permiten forzar de forma segura la liberación de RAM del sistema. */
  public async tool_free_system_memory(): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    return {
      tool: 'tool_free_system_memory',
      status: 'ERROR',
      message: 'No se borró ninguna caché: un navegador web no puede forzar de forma segura la liberación de RAM del sistema.',
      timestamp,
      data: { changed: false }
    };
  }

  // ----------------------------------------------------
  // HERRAMIENTAS DE FACTURA ELECTRÓNICA (DGT COSTA RICA)
  // ----------------------------------------------------

  /**
   * tool_check_dgt_status(): Valida latencia y disponibilidad de Hacienda
   */
  public async tool_check_dgt_status(): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      // Verificamos conectividad con el endpoint de Hacienda
      const res = await fetch('/api/hacienda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping' }),
        signal: controller.signal
      }).catch(() => null);

      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (!res || !res.ok) {
        return {
          tool: 'tool_check_dgt_status',
          status: 'ERROR',
          message: `Servidores de Tributación Directa (DGT) no responden (Latencia > 3000ms o error 5xx).`,
          timestamp,
          data: { available: false, latency }
        };
      }

      return {
        tool: 'tool_check_dgt_status',
        status: 'OK',
        message: `Servicio de Tributación DGT en línea (${latency}ms).`,
        timestamp,
        data: { available: true, latency }
      };
    } catch {
      return {
        tool: 'tool_check_dgt_status',
        status: 'ERROR',
        message: `Tiempo de espera agotado con Hacienda DGT (${Date.now() - start}ms).`,
        timestamp,
        data: { available: false, latency: Date.now() - start }
      };
    }
  }

  /**
   * tool_enable_contingency_mode(reason_code: "02"): Activa Facturación en Contingencia
   */
  public async tool_enable_contingency_mode(isTenantActive: () => boolean, reason_code: string = '02'): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    try {
      if (!isTenantActive()) {
        return { tool: 'tool_enable_contingency_mode', status: 'ERROR', message: 'No se cambió la configuración: el restaurante de la aprobación ya no está activo.', timestamp, data: { changed: false } };
      }
      if (reason_code !== '02') {
        return { tool: 'tool_enable_contingency_mode', status: 'ERROR', message: 'Solo está permitida la clave de contingencia 02.', timestamp, data: { changed: false } };
      }
      const config = haciendaService.getConfig();
      if (!config) {
        return { tool: 'tool_enable_contingency_mode', status: 'ERROR', message: 'No hay una configuración de Hacienda existente; no se creó una nueva configuración vacía.', timestamp, data: { changed: false } };
      }

      if (!isTenantActive()) {
        return { tool: 'tool_enable_contingency_mode', status: 'ERROR', message: 'No se cambió la configuración: el restaurante de la aprobación ya no está activo.', timestamp, data: { changed: false } };
      }
      // Establecer modo contingencia en la configuración
      (config as any).modoContingencia = true;
      (config as any).codigoContingencia = reason_code; // 02 = Servicios DGT no disponibles
      haciendaService.saveConfig(config);

      return {
        tool: 'tool_enable_contingency_mode',
        status: 'OK',
        message: 'La configuración local de contingencia (clave 02) fue guardada. No se verificó una emisión ni conexión con Hacienda.',
        timestamp,
        data: { contingency: true, reason_code }
      };
    } catch (err: any) {
      return {
        tool: 'tool_enable_contingency_mode',
        status: 'ERROR',
        message: `Fallo al activar contingencia: ${err.message}`,
        timestamp
      };
    }
  }

  /**
   * tool_flush_contingency_queue(): Envía en bloque las facturas emitidas en contingencia
   */
  public async tool_flush_contingency_queue(): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    return {
      tool: 'tool_flush_contingency_queue',
      status: 'ERROR',
      message: 'Nyza no envía facturas fiscales en bloque. Revisa la cola y confirma cada envío desde el módulo de facturación.',
      timestamp,
      data: { changed: false }
    };
  }

  // ----------------------------------------------------
  // HERRAMIENTAS DE ESCALAMIENTO
  // ----------------------------------------------------

  /**
   * tool_create_human_ticket(severity: "HIGH"|"CRITICAL", error_log: object)
   */
  public async tool_create_human_ticket(severity: 'HIGH' | 'CRITICAL', error_log: any): Promise<NyzaToolResult> {
    const timestamp = new Date().toISOString();
    void severity;
    void error_log;
    return {
      tool: 'tool_create_human_ticket',
      status: 'ERROR',
      message: 'No se creó ni envió un ticket: esta versión no tiene una integración real de soporte.',
      timestamp,
      data: { changed: false }
    };
  }

  // ----------------------------------------------------
  // DESPACHADOR CENTRAL DE HERRAMIENTAS (ROUTER)
  // ----------------------------------------------------
  public async executeTool(name: string, tenantId: string, isTenantActive: () => boolean, params: Record<string, any> = {}): Promise<NyzaToolResult> {
    const tenantChangedResult: NyzaToolResult = {
      tool: name,
      status: 'ERROR',
      message: 'Se canceló la herramienta porque el restaurante de la aprobación ya no está activo.',
      timestamp: new Date().toISOString(),
      data: { changed: false }
    };
    if (!tenantId || !isTenantActive()) return tenantChangedResult;
    nyzaLearningService.setTenantId(tenantId);
    const startMs = Date.now();
    let result: NyzaToolResult;

    switch (name) {
      case 'tool_ping_device':
        result = await this.tool_ping_device(params.ip || '192.168.1.200');
        break;
      case 'tool_restart_spooler':
        result = await this.tool_restart_spooler();
        break;
      case 'tool_reroute_printer':
        result = await this.tool_reroute_printer(params.failed_ip || 'cocina', params.backup_ip || 'caja', isTenantActive);
        break;
      case 'tool_db_integrity_check':
        result = await this.tool_db_integrity_check(tenantId);
        break;
      case 'tool_db_vacuum_and_repair':
        result = await this.tool_db_vacuum_and_repair();
        break;
      case 'tool_free_system_memory':
        result = await this.tool_free_system_memory();
        break;
      case 'tool_check_dgt_status':
        result = await this.tool_check_dgt_status();
        break;
      case 'tool_enable_contingency_mode':
        result = await this.tool_enable_contingency_mode(isTenantActive, params.reason_code || '02');
        break;
      case 'tool_flush_contingency_queue':
        result = await this.tool_flush_contingency_queue();
        break;
      case 'tool_create_human_ticket':
        result = await this.tool_create_human_ticket(params.severity || 'HIGH', params.error_log || {});
        break;

      // Herramientas del Núcleo de Aprendizaje Continuo e Inteligencia Global
      case 'tool_run_daily_learning': {
        const cycle = nyzaLearningService.runDailyLearningCycle(true);
        result = {
          tool: 'tool_run_daily_learning',
          status: 'OK',
          message: `Resumen local generado; no se entrenó el modelo. ${cycle.summary}`,
          timestamp: new Date().toISOString(),
          data: cycle
        };
        break;
      }
      case 'tool_get_system_iq': {
        result = {
          tool: 'tool_get_system_iq',
          status: 'ERROR',
          message: 'No hay un puntaje IQ, racha ni tasa de resiliencia operativa verificable en esta versión.',
          timestamp: new Date().toISOString(),
          data: { verified: false }
        };
        break;
      }
      case 'tool_teach_heuristic': {
        const { category, title, rule } = params;
        const newH = nyzaLearningService.teachNyza(
          category || 'SYSTEM_HYGIENE',
          title || 'Regla operativa personalizada',
          rule || 'Instrucción aprendida del operador',
          'HIGH'
        );
        result = {
          tool: 'tool_teach_heuristic',
          status: 'OK',
          message: `Nota guardada en este navegador: "${newH.title}". No se modificó el modelo ni se ejecutó una optimización.`,
          timestamp: new Date().toISOString(),
          data: newH
        };
        break;
      }

      default:
        result = {
          tool: name,
          status: 'ERROR',
          message: `Herramienta ${name} no autorizada en la lista blanca de Nyza.`,
          timestamp: new Date().toISOString()
        };
    }

    if (!isTenantActive()) return tenantChangedResult;

    // Registrar telemetría en el motor de aprendizaje continuo
    const elapsed = Date.now() - startMs;
    nyzaLearningService.logObservation(
      'SELF_HEALING_RUN',
      elapsed,
      result.status === 'OK' ? 'OK' : 'ERROR',
      { tool: name, status: result.status }
    );

    return result;
  }
}

export const nyzaSelfHealing = NyzaSelfHealingService.getInstance();
