// IndexedDB Native Service for Offline-First POS Operation in Costa Rica

const DB_NAME = 'saborai_pos_local_db';
const DB_VERSION = 2;

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
    if (pending.length === 0) return { syncedCount: 0 };

    for (const item of pending) {
      // Mark as synced
      item.synced = true;
      await this.saveItem('sync_queue', item);
    }

    const count = await this.getPendingCount();
    this.notify(this.isOnline(), count);
    return { syncedCount: pending.length };
  }
}

export const localDB = new SaboraiLocalDB();
