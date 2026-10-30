import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOperationalScopeMatchesOrder,
  isPayableOrderStatus,
  isTerminalOrderStatus
} from '../api/_utils/offlineSyncValidation.ts';

const order = {
  branch_id: 'branch-1',
  cash_register_id: 'register-1',
  cash_shift_id: 'shift-1',
  terminal_id: 'terminal-1'
};

const scope = {
  branchId: 'branch-1',
  cashRegisterId: 'register-1',
  cashShiftId: 'shift-1',
  terminalId: 'terminal-1'
};

test('acepta el alcance guardado en la orden o campos que el cliente omite', () => {
  assert.doesNotThrow(() => assertOperationalScopeMatchesOrder(scope, order));
  assert.doesNotThrow(() => assertOperationalScopeMatchesOrder({
    branchId: null,
    cashRegisterId: null,
    cashShiftId: null,
    terminalId: null
  }, order));
});

test('rechaza sucursal, caja, turno o terminal distintos de los persistidos', () => {
  for (const field of Object.keys(scope)) {
    assert.throws(() => assertOperationalScopeMatchesOrder({ ...scope, [field]: 'foreign-resource' }, order));
  }
});

test('solo órdenes activas son pagables y estados cerrados/cancelados son terminales', () => {
  for (const status of ['OPEN', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED']) {
    assert.equal(isPayableOrderStatus(status), true);
    assert.equal(isTerminalOrderStatus(status), false);
  }
  for (const status of ['CLOSED', 'CANCELLED']) {
    assert.equal(isPayableOrderStatus(status), false);
    assert.equal(isTerminalOrderStatus(status), true);
  }
  assert.equal(isPayableOrderStatus('UNKNOWN'), false);
});
