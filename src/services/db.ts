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
  tenantId?: string;
  synced: boolean;
  status?: 'PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED';
  attemptCount?: number;
  nextAttemptAt?: string;
  lastError?: string;
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

  async enqueueOfflineAction(action: OfflineSyncQueueItem['action'], payload: any, description?: string, tenantId?: string): Promise<void> {
    const operationId = `sync_${Date.now()}_${crypto.randomUUID?.() || Math.random().toString(36).substring(2, 10)}`;
    const item: OfflineSyncQueueItem = {
      id: operationId,
      action,
      payload,
      timestamp: new Date().toISOString(),
      tenantId: tenantId || (typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_active_tenant_id') || undefined : undefined),
      synced: false,
      status: 'PENDING',
      attemptCount: 0,
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
    return all.filter(item => item.status !== 'SYNCED' && !item.synced).length;
  }

  async getPendingItems(): Promise<OfflineSyncQueueItem[]> {
    const all = await this.getAllItems<OfflineSyncQueueItem>('sync_queue');
    return all
      .filter(item => item.status !== 'SYNCED' && !item.synced)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private async updateQueueItem(item: OfflineSyncQueueItem): Promise<void> {
    await this.saveItem('sync_queue', item);
  }

  private async markFailed(item: OfflineSyncQueueItem, message: string): Promise<void> {
    const attemptCount = (item.attemptCount || 0) + 1;
    const delayMs = Math.min(15 * 60 * 1000, 2 ** Math.min(attemptCount, 8) * 1000);
    await this.updateQueueItem({
      ...item,
      status: 'FAILED',
      synced: false,
      attemptCount,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      lastError: message
    });
  }

  async syncAllPending(): Promise<{ syncedCount: number; failedCount: number; remainingCount: number }> {
    const pending = await this.getPendingItems();
    if (!this.isOnline() || pending.length === 0) {
      return { syncedCount: 0, failedCount: 0, remainingCount: pending.length };
    }

    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('saborai_token') : null;
    if (!token) {
      for (const item of pending) await this.markFailed(item, 'No hay una sesión autenticada para sincronizar.');
      const remainingCount = await this.getPendingCount();
      this.notify(this.isOnline(), remainingCount);
      return { syncedCount: 0, failedCount: pending.length, remainingCount };
    }

    let syncedCount = 0;
    let failedCount = 0;
    for (const originalItem of pending) {
      if (originalItem.nextAttemptAt && new Date(originalItem.nextAttemptAt).getTime() > Date.now()) continue;

      const processingItem: OfflineSyncQueueItem = { ...originalItem, status: 'PROCESSING' };
      await this.updateQueueItem(processingItem);
      try {
        const response = await fetch('/api/offline/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            operationId: processingItem.id,
            tenantId: processingItem.tenantId,
            action: processingItem.action,
            payload: processingItem.payload,
            occurredAt: processingItem.timestamp
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);

        await this.updateQueueItem({
          ...processingItem,
          status: 'SYNCED',
          synced: true,
          lastError: undefined,
          nextAttemptAt: undefined
        });
        syncedCount += 1;
      } catch (error: any) {
        await this.markFailed(processingItem, error?.message || 'No se pudo sincronizar la operación.');
        failedCount += 1;
      }
    }

    const remainingCount = await this.getPendingCount();
    this.notify(this.isOnline(), remainingCount);
    return { syncedCount, failedCount, remainingCount };
  }
}

export const localDB = new SaboraiLocalDB();
