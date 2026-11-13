import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLegacyHaciendaSecretsForTenant,
  getLegacyHaciendaConfigForTenant,
  getTenantItem,
  migrateLegacyDataToTenant
} from '../src/services/tenantStorage.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

async function withFakeBrowser(callback) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} });
  try {
    return await callback(storage);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
}

test('Hacienda legado se mantiene para migración, no se copia a otro tenant y se limpia solo tras confirmación', async () => {
  await withFakeBrowser(storage => {
    const tenantId = '123e4567-e89b-42d3-a456-426614174000';
    const legacyConfig = {
      environment: 'sandbox',
      sucursal: '001',
      atvUsername: 'legacy-user',
      atvPassword: 'legacy-password',
      pinP12: '1234',
      p12Base64: 'CERTIFICATE_DATA'
    };
    storage.setItem('saborai_tenant', JSON.stringify({
      id: tenantId,
      name: 'Restaurante de prueba',
      haciendaConfig: legacyConfig
    }));
    storage.setItem('saborai_hacienda_config', JSON.stringify(legacyConfig));

    migrateLegacyDataToTenant(tenantId);
    assert.equal(getTenantItem('hacienda_config', tenantId), null);
    assert.deepEqual(getLegacyHaciendaConfigForTenant(tenantId), legacyConfig);
    const sanitizedTenant = JSON.parse(storage.getItem('saborai_tenant'));
    assert.equal(sanitizedTenant.haciendaConfig.atvPassword, undefined);
    assert.equal(sanitizedTenant.haciendaConfig.pinP12, undefined);
    assert.notEqual(storage.getItem('saborai_hacienda_config'), null);

    assert.equal(getLegacyHaciendaConfigForTenant('123e4567-e89b-42d3-a456-426614174001'), null);
    clearLegacyHaciendaSecretsForTenant('123e4567-e89b-42d3-a456-426614174001');
    assert.notEqual(storage.getItem('saborai_hacienda_config'), null);

    clearLegacyHaciendaSecretsForTenant(tenantId);
    assert.equal(storage.getItem('saborai_hacienda_config'), null);
    assert.equal(getTenantItem('hacienda_config', tenantId), null);
    const cleanedTenant = JSON.parse(storage.getItem('saborai_tenant'));
    assert.equal(cleanedTenant.haciendaConfig.atvUsername, undefined);
    assert.equal(cleanedTenant.haciendaConfig.atvPassword, undefined);
    assert.equal(cleanedTenant.haciendaConfig.p12Base64, undefined);
  });
});
