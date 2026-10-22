// IndexedDB Native Service for Offline-First POS Operation in Costa Rica

const DB_NAME = 'saborai_pos_local_db';
const DB_VERSION = 3;

export interface TenantOfflineSnapshot {
  tenantId: string;
  version: 1;
  updatedAt: string;
  tenant: any;
  menuItems: any[];
  tables: any[];
  staff: any[];
  kdsOrders: any[];
}

export interface OfflineSyncQueueItem {
  id: string;
  action: 'CREATE_ORDER' | 'UPDATE_TABLE' | 'EMIT_INVOICE' | 'DEDUCT_INVENTORY' | 'PAYMENT';
  payload: any;
  timestamp: string;
  synced: boolean;
  description: string;
}

export class SaboraiLocalDB {
  private db: IDBDatabase | null = null;
  private isSimulatedOffline: boolean = false;
  private listeners: ((isOnline: boolean, pendingCount: number) => void)[] = [];

  async init(): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) return;

    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('tables')) {
          db.createObjectStore('tables', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('menu_items')) {
          db.createObjectStore('menu_items', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('invoices')) {
          db.createObjectStore('invoices', { keyPath: 'clave50Digitos' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tenant_snapshots')) {
          db.createObjectStore('tenant_snapshots', { keyPath: 'tenantId' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.setupNetworkListeners();
        resolve();
      };

      request.onerror = (event) => {
        console.warn('Could not open IndexedDB, falling back to local memory storage:', (event.target as IDBOpenDBRequest).error);
        resolve();
      };
    });
  }

  private setupNetworkListeners() {
    window.addEventListener('online', () => this.handleNetworkChange());
    window.addEventListener('offline', () => this.handleNetworkChange());
  }

  private async handleNetworkChange() {
    const online = this.isOnline();
    const count = await this.getPendingCount();
    this.notify(online, count);
  }

  isOnline(): boolean {
    if (this.isSimulatedOffline) return false;
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  async toggleSimulatedOffline(): Promise<boolean> {
    this.isSimulatedOffline = !this.isSimulatedOffline;
    const online = this.isOnline();
    const count = await this.getPendingCount();
    this.notify(online, count);
    return online;
  }

  subscribe(listener: (isOnline: boolean, pendingCount: number) => void): () => void {
    this.listeners.push(listener);
    this.getPendingCount().then(count => listener(this.isOnline(), count));
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(isOnline: boolean, pendingCount: number) {
    this.listeners.forEach(fn => fn(isOnline, pendingCount));
  }

  async saveItem(storeName: string, item: any): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) {
      try {
        localStorage.setItem(`saborai_${storeName}_${item.id || item.clave50Digitos}`, JSON.stringify(item));
      } catch {}
      return;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async getAllItems<T>(storeName: string): Promise<T[]> {
    if (!this.db) await this.init();
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async enqueueOfflineAction(action: OfflineSyncQueueItem['action'], payload: any, description?: string): Promise<void> {
    const item: OfflineSyncQueueItem = {
      id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      action,
      payload,
      timestamp: new Date().toISOString(),
      synced: false,
      description: description || `Operación ${action} almacenada en memoria local`
    };

    await this.saveItem('sync_queue', item);
    const count = await this.getPendingCount();
    this.notify(this.isOnline(), count);
  }

  async saveTenantSnapshot(snapshot: TenantOfflineSnapshot): Promise<void> {
    if (!snapshot.tenantId) return;
    const safeTenant = snapshot.tenant
      ? {
          ...snapshot.tenant,
          haciendaConfig: snapshot.tenant.haciendaConfig
            ? {
                ...snapshot.tenant.haciendaConfig,
                atvPassword: undefined,
                pinP12: undefined,
                p12Base64: undefined
              }
            : undefined
        }
      : null;
    const safeSnapshot: TenantOfflineSnapshot = {
      ...snapshot,
      tenant: safeTenant
    };

    await this.saveItem('tenant_snapshots', safeSnapshot);
  }

  async getTenantSnapshot(tenantId: string): Promise<TenantOfflineSnapshot | null> {
    if (!tenantId) return null;
    if (!this.db) await this.init();
    if (!this.db) {
      try {
        const raw = localStorage.getItem(`saborai_tenant_snapshots_${tenantId}`);
        return raw ? JSON.parse(raw) as TenantOfflineSnapshot : null;
      } catch {
        return null;
      }
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction('tenant_snapshots', 'readonly');
        const request = tx.objectStore('tenant_snapshots').get(tenantId);
        request.onsuccess = () => resolve((request.result as TenantOfflineSnapshot | undefined) || null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async getPendingCount(): Promise<number> {
    const all = await this.getAllItems<OfflineSyncQueueItem>('sync_queue');
    return all.filter(item => !item.synced).length;
  }

  async getPendingItems(): Promise<OfflineSyncQueueItem[]> {
    const all = await this.getAllItems<OfflineSyncQueueItem>('sync_queue');
    return all.filter(item => !item.synced);
  }

  async syncAllPending(): Promise<{ syncedCount: number }> {
    const pending = await this.getPendingItems();
    // La entrega al backend requiere idempotencia y pertenece a la fase 3.
    // Nunca marcar operaciones como sincronizadas solo por estar online.
    if (pending.length > 0) this.notify(this.isOnline(), pending.length);
    return { syncedCount: 0 };
  }
}

export const localDB = new SaboraiLocalDB();
