import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deactivateEmployee } from '../src/services/employeeSessionService.ts';
import {
  buildEmployeeDeactivationRpcArgs,
  isSuccessfulEmployeeDeactivation,
  mapEmployeeDeactivationError
} from '../api/_utils/employeeLifecycle.ts';

const ownerAdmin = {
  userId: 'owner-uuid',
  email: 'owner@example.cr',
  role: 'ADMIN',
  tenantId: 'tenant-uuid'
};

const employeeAdmin = {
  userId: 'owner-uuid',
  email: 'admin@example.cr',
  role: 'ADMIN',
  tenantId: 'tenant-uuid',
  employeeId: 'admin-row-uuid',
  employeeExternalId: 'admin-profile-id'
};

test('la RPC owner usa tenant y actor de sesión, no campos del cuerpo del navegador', () => {
  assert.deepEqual(buildEmployeeDeactivationRpcArgs(
    ownerAdmin,
    'waiter-1',
    'EMPLOYEE_LEFT_RESTAURANT',
    'server-request-id'
  ), {
    p_tenant_id: 'tenant-uuid',
    p_employee_external_id: 'waiter-1',
    p_actor_user_id: 'owner-uuid',
    p_actor_employee_id: null,
    p_reason: 'EMPLOYEE_LEFT_RESTAURANT',
    p_request_id: 'server-request-id'
  });
});

test('la RPC empleado usa el UUID interno de actor, no su external_id', () => {
  const args = buildEmployeeDeactivationRpcArgs(
    employeeAdmin,
    'waiter-1',
    'EMPLOYEE_LEFT_RESTAURANT',
    'server-request-id'
  );
  assert.equal(args.p_actor_user_id, 'owner-uuid');
  assert.equal(args.p_actor_employee_id, 'admin-row-uuid');
  assert.notEqual(args.p_actor_employee_id, employeeAdmin.employeeExternalId);
  assert.equal(args.p_tenant_id, 'tenant-uuid');
});

test('sólo se acepta confirmación de baja para el colaborador pedido', () => {
  assert.equal(isSuccessfulEmployeeDeactivation({
    success: true,
    deactivated: true,
    alreadyDeactivated: false,
    employeeId: 'waiter-1'
  }, 'waiter-1'), true);
  assert.equal(isSuccessfulEmployeeDeactivation({
    success: true,
    deactivated: false,
    alreadyDeactivated: true,
    employeeId: 'someone-else'
  }, 'waiter-1'), false);
  assert.equal(isSuccessfulEmployeeDeactivation(null, 'waiter-1'), false);
});

test('los errores SQL conocidos se convierten en mensajes seguros y estados HTTP', () => {
  assert.deepEqual(mapEmployeeDeactivationError({
    code: '55000',
    message: 'LAST_ACTIVE_ADMIN',
    details: 'internal row identifiers'
  }), {
    status: 409,
    code: 'LAST_ACTIVE_ADMIN',
    message: 'No se puede eliminar al último administrador activo.'
  });
  assert.equal(mapEmployeeDeactivationError({ message: 'EMPLOYEE_HAS_OPEN_V2_ORDER' }).status, 409);
  assert.equal(mapEmployeeDeactivationError({ message: 'EMPLOYEE_NOT_FOUND_IN_TENANT' }).status, 404);
  assert.equal(mapEmployeeDeactivationError({ message: 'OWNER_EMPLOYEE_REMOVAL_NOT_ALLOWED' }).status, 403);
  const unknown = mapEmployeeDeactivationError({ message: 'secret SQL detail', details: 'internal trace' });
  assert.equal(unknown.status, 503);
  assert.doesNotMatch(JSON.stringify(unknown), /secret SQL detail|internal trace/);
});

test('la ruta de baja es POST, exige sesión ADMIN y deriva tenant/actor del contexto autenticado', async () => {
  const source = await readFile(new URL('../api/auth.ts', import.meta.url), 'utf8');
  assert.match(source, /rawAction === 'employee-deactivate'/);
  assert.match(source, /if \(req\.method !== 'POST'\)/);
  assert.match(source, /const auth = await requireAuth\(req, res\)/);
  assert.match(source, /requireRole\(auth, res, \['ADMIN'\]\)/);
  assert.match(source, /supabase\.rpc\('pos_deactivate_employee', rpcArgs\)/);
  assert.match(source, /employeeExternalId === auth\.userId/);
  assert.match(source, /employeeExternalId === auth\.employeeExternalId/);
  assert.doesNotMatch(source, /p_tenant_id\s*:\s*body\./);
  assert.doesNotMatch(source, /p_actor_user_id\s*:\s*body\./);
  assert.doesNotMatch(source, /p_actor_employee_id\s*:\s*body\./);
});

test('la sincronización del roster no escribe el estado activo del cliente', async () => {
  const [apiSource, clientSource, normalizerSource] = await Promise.all([
    readFile(new URL('../api/auth.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/employeeSessionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/_utils/employeeSession.ts', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(apiSource, /is_active:\s*employee\.active/);
  const syncBlock = clientSource.slice(
    clientSource.indexOf('export async function syncEmployeeRoster'),
    clientSource.indexOf('export async function deactivateEmployee')
  );
  assert.doesNotMatch(syncBlock, /active:\s*member\.active/);
  assert.match(normalizerSource, /client may still send `active`[\s\S]*cannot control lifecycle/i);
  assert.match(apiSource, /\.upsert\(rows, \{ onConflict: 'tenant_id,external_id' \}\)/);
});

test('la pantalla confirma que la baja individual conserva historial y protege propietario/inactivos', async () => {
  const [modalSource, appSource] = await Promise.all([
    readFile(new URL('../src/components/StaffModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(modalSource, /Eliminar del restaurante/);
  assert.match(modalSource, /Su perfil y su historial operativo y fiscal se conservarán/);
  assert.match(modalSource, /Cuenta propietaria/);
  assert.match(modalSource, /!isCurrent && !isOwner/);
  assert.match(appSource, /ownerUserId=\{getAccountUserId\(currentUser\?\.id\)\}/);
  assert.match(appSource, /onRemoveStaffMember=\{handleRemoveStaffMember\}/);
});


test('el cliente invoca la baja por POST con sesión y sólo identifica al colaborador', async () => {
  const previousFetch = globalThis.fetch;
  const previousLocalStorage = globalThis.localStorage;
  let captured;
  globalThis.localStorage = { getItem: key => key === 'saborai_token' ? 'signed-session-token' : null };
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      json: async () => ({
        success: true,
        deactivated: true,
        alreadyDeactivated: false,
        employeeId: 'waiter-1'
      })
    };
  };
  try {
    const result = await deactivateEmployee(' waiter-1 ');
    assert.equal(result.success, true);
    assert.equal(captured.url, '/api/auth/employee-deactivate');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer signed-session-token');
    const body = JSON.parse(captured.options.body);
    assert.deepEqual(body, {
      employeeExternalId: 'waiter-1',
      reason: 'EMPLOYEE_LEFT_RESTAURANT'
    });
    assert.equal('tenantId' in body, false);
    assert.equal('actorUserId' in body, false);
    assert.equal('actorEmployeeId' in body, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  }
});


test('la aplicación rechaza iniciar o cambiar a una sesión de colaborador inactivo', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /if \(staff\.active === false\) throw new Error\('El acceso de este colaborador está desactivado\.'\)/);
});

test('los triggers Cash V2 de comandas abiertas se traducen como bloqueo recuperable', () => {
  for (const code of ['EMPLOYEE_HAS_OPEN_V2_ORDER', 'WAITER_HAS_OPEN_V2_ORDER', 'WAITER_MEMBERSHIP_HAS_OPEN_V2_ORDER']) {
    const mapped = mapEmployeeDeactivationError({ message: code });
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, 'EMPLOYEE_HAS_OPEN_V2_ORDER');
  }
});
