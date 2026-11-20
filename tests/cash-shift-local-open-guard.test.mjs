import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertLegacyShiftOpeningAllowed } from '../src/services/cashShiftLocalOpenGuard.ts';

test('OFF y PREPARED conservan permiso para la apertura local legacy', () => {
  assert.doesNotThrow(() => assertLegacyShiftOpeningAllowed('OFF'));
  assert.doesNotThrow(() => assertLegacyShiftOpeningAllowed('PREPARED'));
});

test('ACTIVE, transiciones, modo ausente o inválido bloquean la apertura local legacy', () => {
  for (const [mode, code] of [
    ['ACTIVE', 'CASH_SHIFT_V2_LEGACY_OPEN_BLOCKED'],
    ['QUIESCING', 'CASH_SHIFT_V2_BRANCH_TRANSITION'],
    ['FROZEN', 'CASH_SHIFT_V2_BRANCH_TRANSITION'],
    [null, 'CASH_SHIFT_V2_MODE_UNAVAILABLE'],
    ['UNKNOWN', 'CASH_SHIFT_V2_MODE_UNAVAILABLE']
  ]) {
    assert.throws(() => assertLegacyShiftOpeningAllowed(mode), error => error.code === code);
  }
});

test('openShift omite por completo el preflight remoto con global OFF y lo conserva antes de mutar cuando V2 está habilitado', async () => {
  const service = await readFile(new URL('../src/services/cashShiftService.ts', import.meta.url), 'utf8');
  const start = service.indexOf('async openShift(');
  const end = service.indexOf('\n  recordSalePayment(', start);
  assert.ok(start >= 0 && end > start);
  const opening = service.slice(start, end);
  const preflight = opening.indexOf('getCashShiftV2BranchMode(');
  const guard = opening.indexOf('assertLegacyShiftOpeningAllowed(branchMode)');
  const stateMutation = opening.indexOf('this.activeShiftsMap[targetRegisterId] = newShift;');
  const persistence = opening.indexOf('this.saveToStorage();', stateMutation);
  assert.match(opening, /if \(CASH_SHIFT_V2_ENABLED && isCloudTenantId\(tenant\?\.id\)\)/);
  assert.match(opening, /register\.branchId/);
  assert.match(opening, /register\.cloudId/);
  assert.ok(preflight >= 0 && guard > preflight && stateMutation > guard && persistence > stateMutation);
  assert.match(service, /import \{ CASH_SHIFT_V2_ENABLED \} from '\.\/cashShiftV2Contract'/);
  const contract = await readFile(new URL('../src/services/cashShiftV2Contract.ts', import.meta.url), 'utf8');
  assert.match(contract, /CASH_SHIFT_V2_ENABLED = false/);

  const modal = await readFile(new URL('../src/components/CashShiftModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /await cashShiftService\.openShift\(/);
});

test('el snapshot cloud conserva IDs de sucursal y caja remota; el preflight envía ambos', async () => {
  const cloud = await readFile(new URL('../src/services/cashControlCloudService.ts', import.meta.url), 'utf8');
  assert.match(cloud, /cloudId: register\.id,[\s\S]*?branchId: register\.branch_id/);
  assert.match(cloud, /'GET_CASH_SHIFT_V2_MODE', \{ branchId, cashRegisterId: cloudRegisterId \}/);
  assert.match(cloud, /result\.tenantId !== tenantId \|\| result\.branchId !== branchId \|\| result\.cashRegisterId !== cloudRegisterId/);

  const api = await readFile(new URL('../api/offline/sync.ts', import.meta.url), 'utf8');
  const readerStart = api.indexOf('async function readCashShiftV2ModeForRegister(');
  const readerEnd = api.indexOf('\nasync function executeOfflineV2Write(', readerStart);
  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  const reader = api.slice(readerStart, readerEnd);
  assert.match(reader, /verifiedBranchId\(tenantId, payload\.branchId\)/);
  assert.match(reader, /eq\('tenant_id', tenantId\)\.eq\('branch_id', branchId\)\.eq\('id', payload\.cashRegisterId\)\.eq\('is_active', true\)/);
  assert.match(reader, /readCashShiftV2Mode\(tenantId, branchId\)/);
  const modeReader = api.slice(readerStart, readerEnd);
  assert.match(modeReader, /isCashShiftV2RoutingEnabled\(CASH_SHIFT_V2_ENABLED, process\.env\.POS_CASH_SHIFT_V2_ENABLED\)[\s\S]*?\? await readCashShiftV2Mode\(tenantId, branchId\)[\s\S]*?: 'OFF'/);
  assert.match(api, /GET_CASH_SHIFT_V2_MODE[\s\S]*?readCashShiftV2ModeForRegister\(tenantId, body\.payload\)/);
});
