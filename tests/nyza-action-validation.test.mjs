import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNyzaAction, getNyzaMenuSnapshot, getNyzaTableSnapshot, validateNyzaAction } from '../src/services/nyzaActionValidation.ts';
import { filterPendingItemsForTenant } from '../src/services/db.ts';
import { runTenantBoundToolSequence } from '../src/services/nyzaToolSequence.ts';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new MemoryStorage();
const { nyzaLearningService } = await import('../src/services/nyzaLearningService.ts');

const menuItem = {
  id: 'menu-1', name: 'Hamburguesa Nyza', description: 'Hamburguesa de prueba', price: 4500,
  category: 'Principal', subcategory: 'Hamburguesas', station: 'Cocina', cabysCode: '123', taxRate: 0.13,
  available: true, imageIcon: 'burger', ingredients: [],
  modifiers: [{
    id: 'mod-1', name: 'Término', isRequired: true, multiple: false,
    choices: [{ name: 'Bien cocido', extraPrice: 300 }, { name: 'Término medio', extraPrice: 0 }]
  }]
};
const table = {
  id: 'table-1', number: 4, name: 'Mesa 4', seats: 4, shape: 'square', status: 'OCCUPIED', zone: 'Salón', x: 20, y: 20,
  activeOrder: { orderNumber: 'O-1', server: 'Mesero', openedAt: '2026-01-01', subAccounts: [{ id: 1, name: 'General' }], items: [] }
};
const tables = [table];
const baseContext = {
  tenantId: 'restaurant-a',
  currentUser: { role: 'SALONERO' },
  menuItems: [menuItem],
  selectedTable: table,
  tables,
  zones: ['Salón']
};

test('bloquea una comanda sin rol autorizado', () => {
  const result = validateNyzaAction({ type: 'ADD_ITEM', product: 'Hamburguesa Nyza' }, {
    ...baseContext,
    currentUser: { role: 'CAJERO' }
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /rol/i);
});

test('bloquea acciones pendientes provenientes de otro tenant', () => {
  const result = validateNyzaAction({ type: 'OPEN_REPORTS', __nyzaExpectedTenantId: 'restaurant-a' }, {
    ...baseContext,
    tenantId: 'restaurant-b',
    currentUser: { role: 'ADMIN' }
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /restaurante activo cambió/i);
});

test('rechaza una acción de chat cuando falta la snapshot de mesa', () => {
  const result = validateNyzaAction({
    type: 'ADD_ITEM',
    __nyzaExpectedTenantId: 'restaurant-a',
    product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, baseContext);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no incluyó una validación de mesa/i);
});

test('requiere producto exacto y único del menú', () => {
  const unknown = validateNyzaAction({ type: 'ADD_ITEM', product: 'Hamburguesa' }, baseContext);
  assert.equal(unknown.ok, false);
  const duplicate = validateNyzaAction({ type: 'ADD_ITEM', product: 'Hamburguesa Nyza' }, {
    ...baseContext,
    menuItems: [menuItem, { ...menuItem, id: 'menu-2' }]
  });
  assert.equal(duplicate.ok, false);
});

test('exige modificador obligatorio válido y reemplaza precios propuestos por los del menú', () => {
  const missingRequired = validateNyzaAction({ type: 'ADD_ITEM', product: 'Hamburguesa Nyza' }, baseContext);
  assert.equal(missingRequired.ok, false);
  const invalidChoice = validateNyzaAction({
    type: 'ADD_ITEM', product: 'Hamburguesa Nyza', modifiers: [{ modifierName: 'Término', choiceName: 'Inventado', extraPrice: -999 }]
  }, baseContext);
  assert.equal(invalidChoice.ok, false);
  const valid = validateNyzaAction({
    type: 'ADD_ITEM', product: 'Hamburguesa Nyza', quantity: 2,
    modifiers: [{ modifierName: 'Término', choiceName: 'Bien cocido', extraPrice: 0 }]
  }, baseContext);
  assert.equal(valid.ok, true);
  if (valid.ok) assert.deepEqual(valid.command.modifiers, [{ modifierName: 'Término', choiceName: 'Bien cocido', extraPrice: 300 }]);
});

test('la vista previa incluye el costo configurado y la mesa exacta', () => {
  const text = describeNyzaAction({
    type: 'ADD_ITEM', product: 'Hamburguesa Nyza', quantity: 2,
    modifiers: [{ modifierName: 'Término', choiceName: 'Bien cocido' }]
  }, { menuItems: [menuItem], selectedTable: table });
  assert.match(text, /Mesa 4/);
  assert.match(text, /₡9(?:,|\u00a0|\u202f)600/);
});

test('rechaza la acción si cambió la mesa desde que se mostró el preview', () => {
  const result = validateNyzaAction({
    type: 'ADD_ITEM', __nyzaExpectedTableId: 'old-table', product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, baseContext);
  assert.equal(result.ok, false);
  assert.match(result.reason, /mesa seleccionada cambió/i);
});

test('rechaza una comanda si cambió el precio o la configuración del producto tras el preview', () => {
  const result = validateNyzaAction({
    type: 'ADD_ITEM', __nyzaExpectedMenuSnapshot: getNyzaMenuSnapshot(menuItem), product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, {
    ...baseContext,
    menuItems: [{ ...menuItem, price: 4700 }]
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cambiaron desde la vista previa/i);
});

test('rechaza agregar si el estado de la mesa/comanda cambió o está reservada', () => {
  const result = validateNyzaAction({
    type: 'ADD_ITEM', __nyzaExpectedTableSnapshot: getNyzaTableSnapshot(table), product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, {
    ...baseContext,
    selectedTable: { ...table, status: 'RESERVED' },
    tables: [{ ...table, status: 'RESERVED' }]
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cambió desde la vista previa/i);
});

test('rechaza agregar si la comanda recibió otro artículo mientras esperaba aprobación', () => {
  const changedTable = {
    ...table,
    activeOrder: {
      ...table.activeOrder,
      items: [{ id: 'new-item', name: 'Otro plato', price: 1000, quantity: 1, selectedModifiers: [] }]
    }
  };
  const result = validateNyzaAction({
    type: 'ADD_ITEM', __nyzaExpectedTableSnapshot: getNyzaTableSnapshot(table), product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, {
    ...baseContext,
    selectedTable: changedTable,
    tables: [changedTable]
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cambió desde la vista previa/i);
});

test('compara snapshots de comanda que superan el antiguo límite silencioso', () => {
  const previewItems = Array.from({ length: 8 }, (_, index) => ({
    id: `old-${index}`, name: `Platillo ${index} ${'x'.repeat(80)}`, price: 1000, quantity: 1, selectedModifiers: []
  }));
  const previewTable = { ...table, activeOrder: { ...table.activeOrder, items: previewItems } };
  const changedTable = {
    ...previewTable,
    activeOrder: { ...previewTable.activeOrder, items: [...previewItems, { id: 'new', name: 'Cambio', price: 1000, quantity: 1, selectedModifiers: [] }] }
  };
  const snapshot = getNyzaTableSnapshot(previewTable);
  assert.ok(snapshot.length > 300);
  const result = validateNyzaAction({
    type: 'ADD_ITEM',
    __nyzaExpectedTenantId: 'restaurant-a',
    __nyzaExpectedTableId: table.id,
    __nyzaExpectedTableSnapshot: snapshot,
    __nyzaExpectedMenuSnapshot: getNyzaMenuSnapshot(menuItem),
    product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, { ...baseContext, selectedTable: changedTable, tables: [changedTable] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cambió desde la vista previa/i);
});

test('compara snapshots de producto que superan el antiguo límite silencioso', () => {
  const longMenuItem = {
    ...menuItem,
    modifiers: Array.from({ length: 30 }, (_, index) => ({
      id: `modifier-${index}`, name: `Opción ${index} ${'m'.repeat(100)}`, isRequired: false, multiple: true,
      choices: Array.from({ length: 4 }, (_, choiceIndex) => ({ name: `Elección ${choiceIndex} ${'c'.repeat(120)}`, extraPrice: choiceIndex }))
    }))
  };
  const snapshot = getNyzaMenuSnapshot(longMenuItem);
  assert.ok(snapshot.length > 3000);
  const result = validateNyzaAction({
    type: 'TOGGLE_DISH_AVAILABILITY',
    __nyzaExpectedTenantId: 'restaurant-a',
    __nyzaExpectedMenuSnapshot: snapshot,
    product: longMenuItem.name,
    available: false
  }, {
    ...baseContext,
    currentUser: { role: 'ADMIN' },
    menuItems: [{ ...longMenuItem, price: longMenuItem.price + 1 }]
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cambió desde la vista previa/i);
});

test('rechaza una snapshot mayor al máximo de verificación en vez de omitirla', () => {
  const result = validateNyzaAction({
    type: 'ADD_ITEM',
    __nyzaExpectedTenantId: 'restaurant-a',
    __nyzaExpectedTableId: table.id,
    __nyzaExpectedTableSnapshot: 'x'.repeat(100_001),
    __nyzaExpectedMenuSnapshot: getNyzaMenuSnapshot(menuItem),
    product: 'Hamburguesa Nyza',
    modifiers: [{ modifierName: 'Término', choiceName: 'Término medio' }]
  }, baseContext);
  assert.equal(result.ok, false);
  assert.match(result.reason, /excede el límite de verificación/i);
});

test('solo permite navegar a menú y reportes con rol ADMIN', () => {
  assert.equal(validateNyzaAction({ type: 'NAVIGATE_TO', params: { view: 'menu' } }, baseContext).ok, false);
  assert.equal(validateNyzaAction({ type: 'OPEN_REPORTS', range: 'today' }, baseContext).ok, false);
  assert.equal(validateNyzaAction({ type: 'OPEN_REPORTS', range: 'today' }, {
    ...baseContext, currentUser: { role: 'ADMIN' }
  }).ok, true);
});

test('valida rango, salón, capacidad y mesa duplicada antes de crear mesas', () => {
  const invalidZone = validateNyzaAction({ type: 'ADD_TABLE_RANGE', zone: 'No existe', from: 5, to: 6, seats: 2 }, {
    ...baseContext, currentUser: { role: 'ADMIN' }
  });
  assert.equal(invalidZone.ok, false);
  const duplicate = validateNyzaAction({ type: 'ADD_TABLE_RANGE', zone: 'Salón', from: 4, to: 5, seats: 2 }, {
    ...baseContext, currentUser: { role: 'ADMIN' }
  });
  assert.equal(duplicate.ok, false);
});

test('bloquea herramientas fiscales en bloque y herramientas no incluidas en la lista autorizada', () => {
  const result = validateNyzaAction({ type: 'TOOL_CALLS', tool_calls: [{ name: 'tool_flush_contingency_queue', parameters: {} }] }, {
    ...baseContext, currentUser: { role: 'ADMIN' }
  });
  assert.equal(result.ok, false);
});

test('mantiene las notas locales aisladas por tenant en el mismo navegador', () => {
  nyzaLearningService.setTenantId('restaurant-a');
  nyzaLearningService.teachNyza('KITCHEN_SPEED', 'Nota local A', 'Regla de prueba del negocio A');
  nyzaLearningService.setTenantId('restaurant-b');
  assert.equal(nyzaLearningService.getHeuristics().length, 0);
  nyzaLearningService.teachNyza('KITCHEN_SPEED', 'Nota local B', 'Regla de prueba del negocio B');
  nyzaLearningService.setTenantId('restaurant-a');
  assert.deepEqual(nyzaLearningService.getHeuristics().map(item => item.title), ['Nota local A']);
  nyzaLearningService.setTenantId('restaurant-b');
  assert.deepEqual(nyzaLearningService.getHeuristics().map(item => item.title), ['Nota local B']);
});

test('filtra cola offline estrictamente por tenant y excluye elementos legacy sin tenant', () => {
  const base = { action: 'PAYMENT', payload: {}, timestamp: '2026-01-01T00:00:00Z', synced: false, status: 'PENDING', description: 'synthetic' };
  const pending = filterPendingItemsForTenant([
    { ...base, id: 'a', tenantId: 'restaurant-a' },
    { ...base, id: 'b', tenantId: 'restaurant-b' },
    { ...base, id: 'legacy' },
    { ...base, id: 'done', tenantId: 'restaurant-a', synced: true, status: 'SYNCED' }
  ], 'restaurant-a');
  assert.deepEqual(pending.map(item => item.id), ['a']);
});

test('cancela herramientas Nyza restantes si cambia el tenant durante una herramienta async', async () => {
  let activeTenantId = 'restaurant-a';
  const invoked = [];
  const reported = [];
  const result = await runTenantBoundToolSequence(
    'restaurant-a',
    ['read-status', 'reroute-printer'],
    () => activeTenantId,
    async tool => {
      invoked.push(tool);
      if (tool === 'read-status') {
        await Promise.resolve();
        activeTenantId = 'restaurant-b';
      }
      return `synthetic-${tool}`;
    },
    (tool, value) => reported.push([tool, value])
  );
  assert.equal(result, 'CANCELLED');
  assert.deepEqual(invoked, ['read-status']);
  assert.deepEqual(reported, []);
});

test('no inicia herramientas si el tenant ya cambió antes de ejecutar', async () => {
  const invoked = [];
  const result = await runTenantBoundToolSequence(
    'restaurant-a',
    ['reroute-printer'],
    () => 'restaurant-b',
    async tool => { invoked.push(tool); return 'synthetic-result'; },
    () => {}
  );
  assert.equal(result, 'CANCELLED');
  assert.deepEqual(invoked, []);
});
