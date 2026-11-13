import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./hacienda-client-security-loader.mjs', import.meta.url));
const { haciendaService } = await import('../src/services/haciendaService.ts');

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  key(index) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

test('el cliente filtra credenciales de respuestas Hacienda y no devuelve el body crudo del test', async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { dispatchEvent: () => true } });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, writable: true, value: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      environment: 'production',
      tokenOk: true,
      certOk: true,
      expiresOn: '2030-01-01T00:00:00.000Z',
      message: 'Conexión validada.',
      atvPassword: 'LEAKED_PASSWORD',
      pinP12: 'LEAKED_PIN',
      p12Base64: 'LEAKED_CERTIFICATE',
      details: { secret: 'LEAKED_DETAIL' },
      config: {
        environment: 'production',
        isValidated: true,
        atvUsernameConfigured: true,
        certificateConfigured: true,
        atvPassword: 'LEAKED_CONFIG_PASSWORD',
        pinP12: 'LEAKED_CONFIG_PIN',
        p12Base64: 'LEAKED_CONFIG_CERTIFICATE'
      }
    })
  });

  try {
    const result = await haciendaService.testConnection('123e4567-e89b-42d3-a456-426614174000', '001');
    assert.equal(result.success, true);
    assert.deepEqual(result.details, {
      environment: 'production',
      tokenOk: true,
      certOk: true,
      expiresOn: '2030-01-01T00:00:00.000Z'
    });
    assert.equal(JSON.stringify(result).includes('LEAKED_'), false);
    const config = haciendaService.getConfig('123e4567-e89b-42d3-a456-426614174000', '001');
    assert.equal(config?.atvPassword, undefined);
    assert.equal(config?.pinP12, undefined);
    assert.equal(config?.p12Base64, undefined);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
    if (previousCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', previousCustomEvent);
    else delete globalThis.CustomEvent;
  }
});

test('una respuesta ambigua de Hacienda permanece PROCESANDO y consulta la clave, no RECHAZADO', async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const previousTimeout = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  const scheduled = [];
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    writable: true,
    value: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; }
  });
  let emissionCalls = 0;
  let nextHttpStatus = 400;
  globalThis.fetch = async () => {
    emissionCalls += 1;
    return { ok: false, status: nextHttpStatus, json: async () => ({ error: nextHttpStatus === 400 ? 'synthetic validation error' : 'synthetic gateway timeout' }) };
  };

  const tenantId = '123e4567-e89b-42d3-a456-426614174000';
  const invoice = {
    clave50Digitos: '5'.repeat(50),
    consecutivo: '1'.repeat(20),
    emisor: { nombre: 'Restaurante de prueba', cedulaJuridica: '3101234567', nombreComercial: 'Prueba', correo: '', sucursal: '001', terminal: '00001' },
    receptor: { nombre: 'Cliente de prueba', tipoIdentificacion: '01-Fisica', identificacion: '', correo: '' },
    fechaEmision: '2026-11-12T12:00:00.000Z',
    condicionVenta: '01-Efectivo',
    tipoDocumento: 'TE',
    medioPago: 'Efectivo',
    pagos: [{ tipo: 'efectivo', monto: 1000 }],
    moneda: 'CRC',
    tipoCambio: 1,
    items: [{ name: 'Producto de prueba', price: 1000, quantity: 1, cabysCode: '1234567890123', taxRate: 0, category: 'Comida' }],
    subtotal: 1000,
    iva13: 0,
    iva4: 0,
    iva2: 0,
    iva1: 0,
    servicio10: 0,
    totalComprobante: 1000,
    estadoHacienda: 'PROCESANDO',
    xmlContent: '<FacturaElectronica />'
  };
  const config = {
    isValidated: true,
    atvUsernameConfigured: true,
    atvPasswordConfigured: true,
    certificateConfigured: true,
    cedulaEmisor: '3101234567',
    codigoActividad: '561001',
    provincia: 'San José',
    canton: 'Central',
    distrito: 'Carmen',
    otrasSenas: 'Prueba automatizada'
  };
  const statuses = [];

  try {
    const localFailureInvoice = { ...invoice, clave50Digitos: '6'.repeat(50) };
    await haciendaService.emitInvoice(localFailureInvoice, (status, message) => statuses.push({ status, message }), config, tenantId);
    const localFailure = haciendaService.getInvoices(tenantId).find(item => item.clave50Digitos === localFailureInvoice.clave50Digitos);
    assert.equal(localFailure?.estadoHacienda, 'ERROR_LOCAL');
    assert.equal(statuses.at(-1)?.status, 'ERROR_LOCAL');
    assert.equal(scheduled.length, 0);

    nextHttpStatus = 504;
    await haciendaService.emitInvoice(invoice, (status, message) => statuses.push({ status, message }), config, tenantId);
    const saved = haciendaService.getInvoices(tenantId).find(item => item.clave50Digitos === invoice.clave50Digitos);
    assert.equal(saved?.estadoHacienda, 'PROCESANDO');
    assert.match(saved?.errorMensaje || '', /no se confirmó/i);
    assert.ok(statuses.some(item => item.status === 'INCIERTO'));
    assert.equal(statuses.some(item => item.status === 'RECHAZADO'), false);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 2500);
    haciendaService.resendInvoice(invoice.clave50Digitos, (status, message) => statuses.push({ status, message }), tenantId);
    assert.equal(emissionCalls, 2);
    assert.equal(statuses.at(-1)?.status, 'PROCESANDO');
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
    if (previousTimeout) Object.defineProperty(globalThis, 'setTimeout', previousTimeout);
    else globalThis.setTimeout = setTimeout;
  }
});
