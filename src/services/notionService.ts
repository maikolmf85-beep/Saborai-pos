// SaborAI POS - Notion API Integration Service
import { UserProfile, TenantInfo } from '../types';

export interface NotionConfig {
  apiKey: string;
  parentPageId: string;
  databaseId: string;
  databaseUrl?: string;
  autoSyncOnRegister: boolean;
  isConnected: boolean;
  lastSyncTime?: string;
}

export interface NotionSyncRecord {
  id: string;
  user: UserProfile;
  tenant: TenantInfo;
  synced: boolean;
  notionPageId?: string;
  notionPageUrl?: string;
  timestamp: string;
  error?: string;
}

export function formatUserRole(role?: string): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'SALONERO':
    case 'WAITER':
      return 'Salonero';
    case 'CAJERO':
      return 'Cajero';
    case 'SALONERO_CAJA':
      return 'Salonero con Caja';
    default:
      return role || 'Salonero';
  }
}

const STORAGE_KEY_CONFIG = 'saborai_notion_config';
const STORAGE_KEY_RECORDS = 'saborai_notion_records';

class NotionService {
  private config: NotionConfig = {
    apiKey: '',
    parentPageId: '',
    databaseId: '',
    databaseUrl: '',
    autoSyncOnRegister: true,
    isConnected: false
  };

  private records: NotionSyncRecord[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        this.config = { ...this.config, ...JSON.parse(savedConfig) };
      }
      const savedRecords = localStorage.getItem(STORAGE_KEY_RECORDS);
      if (savedRecords) {
        this.records = JSON.parse(savedRecords);
      } else {
        // Initial sample record if none exists
        this.records = [
          {
            id: 'rec_demo_01',
            user: {
              id: 'usr_demo_01',
              name: 'Administrador Demo (Fuego & Palmera)',
              email: 'gerencia@fuegoypalmera.cr',
              phone: '+506 2289-4500',
              restaurantName: 'Restaurante Fuego & Palmera',
              role: 'ADMIN'
            },
            tenant: {
              id: 'tenant_demo_01',
              name: 'Restaurante Fuego & Palmera S.A.',
              cedulaJuridica: '3-101-789456',
              email: 'gerencia@fuegoypalmera.cr',
              phone: '+506 2289-4500',
              location: 'Escazú Village, San José',
              plan: 'pro',
              status: 'ACTIVE',
              currency: 'CRC',
              monthlyFee: 45000
            },
            synced: true,
            notionPageId: 'page_demo_101',
            notionPageUrl: 'https://notion.so',
            timestamp: new Date().toISOString()
          }
        ];
        this.saveRecordsToStorage();
      }
    } catch (e) {
      console.warn('Error loading Notion data from storage:', e);
    }
  }

  private saveConfigToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    } catch {}
  }

  private saveRecordsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(this.records));
    } catch {}
  }

  getConfig(): NotionConfig {
    return { ...this.config };
  }

  saveConfig(newConfig: Partial<NotionConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfigToStorage();
  }

  getRecords(): NotionSyncRecord[] {
    return [...this.records];
  }

  /**
   * Cleans any Notion page URL or UUID string to return the 32-character ID.
   */
  normalizeNotionId(input: string): string {
    if (!input) return '';
    const clean = input.trim();
    // If it's a URL like https://notion.so/workspace/Page-Name-a1b2c3d4e5f6...
    const urlMatches = clean.match(/([a-f0-9]{32})(?:[/?#]|$)/i);
    if (urlMatches && urlMatches[1]) {
      return urlMatches[1];
    }
    // If it has hyphens like a1b2c3d4-e5f6-...
    const withoutHyphens = clean.replace(/-/g, '');
    const hexMatch = withoutHyphens.match(/[a-f0-9]{32}/i);
    if (hexMatch) {
      return hexMatch[0];
    }
    return clean;
  }

  /**
   * Helper to make requests through Vite dev server proxy or directly
   */
  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const apiKey = this.config.apiKey.trim();
    if (!apiKey) {
      throw new Error('No se ha configurado la API Key de Notion.');
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    // Use local proxy /api/notion to avoid browser CORS restrictions
    const url = `/api/notion${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Error ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Tests the Notion API connection by querying the current integration user
   */
  async testConnection(customApiKey?: string): Promise<{ success: boolean; botName?: string; message: string }> {
    const token = (customApiKey || this.config.apiKey).trim();
    if (!token) {
      return { success: false, message: 'Ingresa tu Token de Integración de Notion (ntn_... o secret_...)' };
    }

    // Check if user is running a demo test
    if (token.startsWith('demo') || token === 'demo') {
      this.config.isConnected = true;
      this.config.apiKey = token;
      this.saveConfigToStorage();
      return {
        success: true,
        botName: 'SaborAI POS Bot (Modo Demostración)',
        message: 'Conexión simulada verificada correctamente.'
      };
    }

    try {
      const data = await this.request('/users/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      this.config.isConnected = true;
      this.config.apiKey = token;
      this.saveConfigToStorage();
      return {
        success: true,
        botName: data.name || data.bot?.owner?.workspace_name || 'Integración SaborAI',
        message: '¡Conexión exitosa con Notion!'
      };
    } catch (err: any) {
      console.error('Notion test connection error:', err);
      return {
        success: false,
        message: err.message || 'No se pudo conectar con Notion. Verifica tu Token y permisos de integración.'
      };
    }
  }

  /**
   * Creates the SaborAI User Registration Database in Notion
   */
  async createUsersDatabase(parentPageIdInput?: string): Promise<{ success: boolean; databaseId?: string; url?: string; message: string }> {
    const parentId = this.normalizeNotionId(parentPageIdInput || this.config.parentPageId);
    if (!parentId) {
      return {
        success: false,
        message: 'Por favor indica el ID o URL de la página de Notion donde se creará la base de datos.'
      };
    }

    // Demo mode support
    if (this.config.apiKey.startsWith('demo') || this.config.apiKey === 'demo' || !this.config.apiKey) {
      const mockId = `db_${Date.now()}_saborai`;
      const mockUrl = `https://notion.so/SaborAI-Registro-de-Usuarios-${mockId}`;
      this.config.databaseId = mockId;
      this.config.databaseUrl = mockUrl;
      this.config.parentPageId = parentId;
      this.config.isConnected = true;
      this.config.lastSyncTime = new Date().toISOString();
      this.saveConfigToStorage();

      return {
        success: true,
        databaseId: mockId,
        url: mockUrl,
        message: 'Base de datos "SaborAI - Registro de Usuarios & Restaurantes" creada con éxito (Modo Asistido).'
      };
    }

    const payload = {
      parent: {
        type: 'page_id',
        page_id: parentId
      },
      title: [
        {
          type: 'text',
          text: {
            content: 'SaborAI - Registro de Usuarios & Restaurantes'
          }
        }
      ],
      properties: {
        'Nombre': { title: {} },
        'Restaurante': { rich_text: {} },
        'Correo': { email: {} },
        'Teléfono': { phone_number: {} },
        'Rol': {
          select: {
            options: [
              { name: 'Administrador', color: 'blue' },
              { name: 'Salonero', color: 'green' },
              { name: 'Cajero', color: 'orange' },
              { name: 'Salonero con Caja', color: 'purple' }
            ]
          }
        },
        'Plan SaborAI': {
          select: {
            options: [
              { name: 'Express', color: 'yellow' },
              { name: 'Pro', color: 'purple' },
              { name: 'Multisucursal', color: 'pink' }
            ]
          }
        },
        'Fecha Registro': { date: {} },
        'ID Usuario': { rich_text: {} },
        'ID Restaurante': { rich_text: {} },
        'Estado': { status: {} },
        'Cédula Jurídica': { rich_text: {} },
        'Ubicación': { rich_text: {} }
      }
    };

    try {
      const result = await this.request('/databases', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      this.config.databaseId = result.id;
      this.config.databaseUrl = result.url;
      this.config.parentPageId = parentId;
      this.config.isConnected = true;
      this.config.lastSyncTime = new Date().toISOString();
      this.saveConfigToStorage();

      return {
        success: true,
        databaseId: result.id,
        url: result.url,
        message: '¡Base de datos creada exitosamente en tu espacio de Notion!'
      };
    } catch (err: any) {
      console.error('Error creating Notion database:', err);
      return {
        success: false,
        message: `Error al crear la base de datos: ${err.message}. Asegúrate de haber compartido la página de Notion con la integración ("Conectar a...").`
      };
    }
  }

  /**
   * Inserts a registered user and tenant into Notion as a new database page
   */
  async recordUserRegistration(user: UserProfile, tenant: TenantInfo): Promise<NotionSyncRecord> {
    const recordId = `rec_${Date.now()}`;
    const newRecord: NotionSyncRecord = {
      id: recordId,
      user,
      tenant,
      synced: false,
      timestamp: new Date().toISOString()
    };

    this.records = [newRecord, ...this.records];
    this.saveRecordsToStorage();

    // If auto-sync is disabled or no database is configured, keep it locally pending
    if (!this.config.databaseId) {
      newRecord.error = 'Base de datos de Notion no configurada';
      this.saveRecordsToStorage();
      return newRecord;
    }

    // Demo mode simulation
    if (this.config.apiKey.startsWith('demo') || this.config.apiKey === 'demo' || !this.config.apiKey) {
      newRecord.synced = true;
      newRecord.notionPageId = `page_${Date.now()}`;
      newRecord.notionPageUrl = this.config.databaseUrl || 'https://notion.so';
      this.config.lastSyncTime = new Date().toISOString();
      this.saveConfigToStorage();
      this.saveRecordsToStorage();
      return newRecord;
    }

    // Real Notion API page creation
    try {
      const planName = tenant.plan === 'pro' ? 'Pro' : tenant.plan === 'multibranch' ? 'Multisucursal' : 'Express';

      const payload = {
        parent: { database_id: this.config.databaseId },
        properties: {
          'Nombre': {
            title: [{ text: { content: user.name || 'Sin Nombre' } }]
          },
          'Restaurante': {
            rich_text: [{ text: { content: user.restaurantName || tenant.name || 'Restaurante SaborAI' } }]
          },
          'Correo': {
            email: user.email || null
          },
          'Teléfono': {
            phone_number: user.phone || null
          },
          'Rol': {
            select: { name: formatUserRole(user.role) }
          },
          'Plan SaborAI': {
            select: { name: planName }
          },
          'Fecha Registro': {
            date: { start: new Date().toISOString() }
          },
          'ID Usuario': {
            rich_text: [{ text: { content: user.id } }]
          },
          'ID Restaurante': {
            rich_text: [{ text: { content: tenant.id } }]
          },
          'Estado': {
            status: { name: 'Activo' }
          },
          'Cédula Jurídica': {
            rich_text: [{ text: { content: tenant.cedulaJuridica || 'N/A' } }]
          },
          'Ubicación': {
            rich_text: [{ text: { content: tenant.location || 'Costa Rica' } }]
          }
        }
      };

      const result = await this.request('/pages', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      newRecord.synced = true;
      newRecord.notionPageId = result.id;
      newRecord.notionPageUrl = result.url;
      delete newRecord.error;
      this.config.lastSyncTime = new Date().toISOString();
      this.saveConfigToStorage();
      this.saveRecordsToStorage();
    } catch (err: any) {
      console.error('Error syncing user to Notion:', err);
      newRecord.error = err.message || 'Error al enviar registro a Notion';
      this.saveRecordsToStorage();
    }

    return newRecord;
  }

  /**
   * Synchronizes all unsynced local records to Notion
   */
  async syncAllPendingUsers(): Promise<{ syncedCount: number; errors: number }> {
    let syncedCount = 0;
    let errors = 0;

    for (let i = 0; i < this.records.length; i++) {
      if (!this.records[i].synced) {
        try {
          await this.recordUserRegistration(this.records[i].user, this.records[i].tenant);
          if (this.records[i].synced) syncedCount++;
          else errors++;
        } catch {
          errors++;
        }
      }
    }

    return { syncedCount, errors };
  }
}

export const notionService = new NotionService();
