import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDispatchOperationId, getUndispatchedItems } from '../src/services/inventoryDispatch.ts';
import { cloudMenuItemId, localIngredientId } from '../api/_utils/inventoryIds.ts';
import { ROLE_PERMISSIONS } from '../api/_utils/rolePermissions.ts';

function installMemoryStorage() {
  const data = new Map([['saborai_active_tenant_id', 'tenant-test']]);
  globalThis.localStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
  globalThis.CustomEvent ||= class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };
  globalThis.window = { dispatchEvent: () => true };
}

test('los ids de insumo son canónicos y el id cloud queda limitado por tenant/sucursal', () => {
  assert.equal(localIngredientId(' Pollo '), localIngredientId('pollo'));
  assert.equal(cloudMenuItemId('tenant-a', 'branch-a', 'item-1'), cloudMenuItemId('tenant-a', 'branch-a', 'item-1'));
  assert.notEqual(cloudMenuItemId('tenant-a', 'branch-a', 'item-1'), cloudMenuItemId('tenant-b', 'branch-a', 'item-1'));
});

test('el descuento de una receta actualiza el mismo insumo compartido por otros platos', async () => {
  installMemoryStorage();
  const { InventoryService, ingredientIdForName } = await import('../src/services/inventoryService.ts');
  const service = new InventoryService();
  const chickenId = ingredientIdForName('Pollo deshuesado');
  const mashId = ingredientIdForName('Puré');
  const vegetablesId = ingredientIdForName('Vegetales');
  const catalog = [
    { id: chickenId, name: 'Pollo deshuesado', unit: 'g', currentStock: 1000 },
    { id: mashId, name: 'Puré', unit: 'g', currentStock: 1300 },
    { id: vegetablesId, name: 'Vegetales', unit: 'g', currentStock: 1000 }
  ];
  const menu = [
    { id: 'dish-grill', name: 'Pollo a la parrilla', available: true, ingredients: [
      { ingredientId: chickenId, name: 'Pollo deshuesado', requiredQty: 200, unit: 'g', currentStock: 1000 },
      { ingredientId: mashId, name: 'Puré', requiredQty: 260, unit: 'g', currentStock: 1300 },
      { ingredientId: vegetablesId, name: 'Vegetales', requiredQty: 200, unit: 'g', currentStock: 1000 }
    ] },
    { id: 'dish-salad', name: 'Ensalada con pollo', available: true, ingredients: [
      { ingredientId: chickenId, name: 'Pollo deshuesado', requiredQty: 100, unit: 'g', currentStock: 1000 }
    ] }
  ];
  service.saveCatalogAndMenu(catalog, menu);
  const dispatchLine = [{ menuItemId: 'dish-grill', name: 'Pollo a la parrilla', quantity: 2 }];
  service.deductItemsStock(dispatchLine, 'DISPATCH_DEDUCTION', undefined, 'dispatch:tenant-test:ORD-1:line-1');
  service.deductItemsStock(dispatchLine, 'DISPATCH_DEDUCTION', undefined, 'dispatch:tenant-test:ORD-1:line-1');

  const stock = service.getCatalog();
  assert.equal(stock.find(item => item.id === chickenId).currentStock, 600);
  assert.equal(stock.find(item => item.id === mashId).currentStock, 780);
  assert.equal(stock.find(item => item.id === vegetablesId).currentStock, 600);
  const updatedMenu = service.getMenu();
  assert.equal(updatedMenu.find(item => item.id === 'dish-salad').ingredients[0].currentStock, 600);
});

test('usa menuItemId antes del nombre y no descuenta otro producto homónimo', async () => {
  installMemoryStorage();
  const { InventoryService, ingredientIdForName } = await import('../src/services/inventoryService.ts');
  const service = new InventoryService();
  const riceId = ingredientIdForName('Arroz');
  const beansId = ingredientIdForName('Frijoles');
  service.saveCatalogAndMenu(
    [
      { id: riceId, name: 'Arroz', unit: 'g', currentStock: 100 },
      { id: beansId, name: 'Frijoles', unit: 'g', currentStock: 100 }
    ],
    [
      { id: 'bowl-rice', name: 'Bowl del día', available: true, ingredients: [{ ingredientId: riceId, name: 'Arroz', requiredQty: 10, unit: 'g', currentStock: 100 }] },
      { id: 'bowl-beans', name: 'Bowl del día', available: true, ingredients: [{ ingredientId: beansId, name: 'Frijoles', requiredQty: 20, unit: 'g', currentStock: 100 }] }
    ]
  );
  service.deductItemsStock([{ menuItemId: 'bowl-rice', name: 'Bowl del día', quantity: 1 }], 'DISPATCH_DEDUCTION');
  const stock = service.getCatalog();
  assert.equal(stock.find(item => item.id === riceId).currentStock, 90);
  assert.equal(stock.find(item => item.id === beansId).currentStock, 100);
});

test('el catálogo y menú locales quedan aislados por tenant aunque cambie el tenant activo', async () => {
  installMemoryStorage();
  const { InventoryService, ingredientIdForName } = await import('../src/services/inventoryService.ts');
  const service = new InventoryService();
  const id = ingredientIdForName('Café');
  service.saveCatalogAndMenu(
    [{ id, name: 'Café', unit: 'g', currentStock: 700 }],
    [{ id: 'drink-a', name: 'Café americano', available: true, ingredients: [{ ingredientId: id, name: 'Café', requiredQty: 18, unit: 'g', currentStock: 700 }] }],
    'tenant-a'
  );
  service.saveCatalogAndMenu(
    [{ id, name: 'Café', unit: 'g', currentStock: 90 }],
    [{ id: 'drink-b', name: 'Café frío', available: true, ingredients: [{ ingredientId: id, name: 'Café', requiredQty: 20, unit: 'g', currentStock: 90 }] }],
    'tenant-b'
  );
  assert.equal(service.getCatalog(undefined, 'tenant-a')[0].currentStock, 700);
  assert.equal(service.getCatalog(undefined, 'tenant-b')[0].currentStock, 90);
  assert.equal(service.getMenu('tenant-a')[0].id, 'drink-a');
  assert.equal(service.getMenu('tenant-b')[0].id, 'drink-b');
});

test('la clave de un reintento de despacho es estable por renglón y distinta para otro renglón', () => {
  const first = createDispatchOperationId('tenant-a', 'ORD-100', 'line-1');
  assert.equal(first, createDispatchOperationId('tenant-a', 'ORD-100', 'line-1'));
  assert.notEqual(first, createDispatchOperationId('tenant-a', 'ORD-100', 'line-2'));
  assert.notEqual(first, createDispatchOperationId('tenant-b', 'ORD-100', 'line-1'));
});

test('el pago excluye las líneas ya descontadas en el despacho', () => {
  const sent = { id: 'line-sent', inventoryDeductedAtDispatch: true };
  const unsent = { id: 'line-unsent', inventoryDeductedAtDispatch: false };
  const legacy = { id: 'line-legacy' };
  assert.deepEqual(getUndispatchedItems([sent, unsent, legacy]), [unsent, legacy]);
  assert.ok(ROLE_PERMISSIONS.offlineSync.DISPATCH_INVENTORY.includes('SALONERO'));
  assert.ok(!ROLE_PERMISSIONS.offlineSync.DEDUCT_INVENTORY.includes('SALONERO'));
});

test('la migración usa el esquema real de movimientos y su alcance operativo', () => {
  const schema = readFileSync(new URL('../supabase/migrations/20261017000000_pos_core.sql', import.meta.url), 'utf8');
  const operationalScope = readFileSync(new URL('../supabase/migrations/20261026020000_phase9_operational_scope.sql', import.meta.url), 'utf8');
  assert.match(schema, /create table if not exists public\.pos_inventory_movements[\s\S]*movement_type text not null check \(movement_type in \('SALE', 'RESTOCK', 'WASTE', 'ADJUSTMENT'\)\)[\s\S]*quantity numeric\(14,4\) not null[\s\S]*idempotency_key text not null[\s\S]*unique \(tenant_id, idempotency_key\)/i);
  assert.match(operationalScope, /alter table public\.pos_inventory_movements[\s\S]*cash_shift_id[\s\S]*cash_register_id[\s\S]*terminal_id/i);
  assert.match(operationalScope, /create trigger pos_inventory_validate_operational_scope[\s\S]*on public\.pos_inventory_movements/i);
});

test('la RPC rechaza una clave reusada con valores distintos y devuelve el resultado original', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261104160000_inventory_stock_adjustment.sql', import.meta.url), 'utf8');
  const inventoryUi = readFileSync(new URL('../src/components/InventoryRecipes.tsx', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists requested_adjustment numeric\(14,4\)/i);
  assert.match(sql, /add column if not exists resulting_stock numeric\(14,4\)/i);
  assert.equal((sql.match(/existing_adjustment_request is distinct from p_adjustment/gi) || []).length, 2);
  assert.equal((sql.match(/existing_movement_type is distinct from expected_movement_type/gi) || []).length, 2);
  assert.equal((sql.match(/existing_ingredient_id is distinct from p_ingredient_id/gi) || []).length, 2);
  assert.equal((sql.match(/existing_reason is distinct from normalized_reason/gi) || []).length, 2);
  assert.equal((sql.match(/existing_created_by is distinct from p_created_by/gi) || []).length, 2);
  assert.equal((sql.match(/existing_quantity > abs\(existing_adjustment_request\)/gi) || []).length, 2);
  assert.equal((sql.match(/existing_quantity <> existing_adjustment_request/gi) || []).length, 2);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock[\s\S]*hashtext/i);
  assert.match(sql, /'stockAfterOperation', existing_resulting_stock/i);
  assert.equal((sql.match(/'stockAfterOperation', existing_resulting_stock/gi) || []).length, 2);
  const retrySection = sql.slice(sql.indexOf('-- A retry returns'), sql.indexOf('select i.current_stock into locked_stock'));
  assert.match(retrySection, /'stockAfterOperation', existing_resulting_stock/i);
  assert.doesNotMatch(retrySection, /select i\.current_stock/i);
  assert.match(inventoryUi, /result\?\.stockAfterOperation/);
});

test('la RPC no confirma movimientos nulos/cero y limita explícitamente el acceso', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261104160000_inventory_stock_adjustment.sql', import.meta.url), 'utf8');
  assert.match(sql, /p_adjustment = 0[\s\S]*p_adjustment <> round\(p_adjustment, 4\)/i);
  assert.match(sql, /if applied_adjustment = 0 then[\s\S]*raise exception/i);
  const zeroGuard = sql.indexOf('if applied_adjustment = 0 then');
  const movementInsert = sql.indexOf('insert into public.pos_inventory_movements');
  assert.ok(zeroGuard > 0 && zeroGuard < movementInsert);
  const movementInsertSql = sql.slice(movementInsert, sql.indexOf('on conflict', movementInsert));
  assert.match(movementInsertSql, /abs\(applied_adjustment\)/i);
  assert.match(movementInsertSql, /resulting_stock[\s\S]*new_stock/i);
  assert.match(sql, /existing_quantity <= 0[\s\S]*existing_resulting_stock is null/i);
  assert.match(sql, /revoke all on function public\.apply_inventory_adjustment[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.apply_inventory_adjustment[\s\S]*to service_role/i);
});
