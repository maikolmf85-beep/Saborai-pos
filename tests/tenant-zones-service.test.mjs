import test from 'node:test';
import assert from 'node:assert/strict';
import { persistTenantZones } from '../src/services/tenantZonesService.ts';

function response(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('envía salones con el token y devuelve la lista confirmada por el servidor', async () => {
  let request;
  const savedZones = await persistTenantZones(
    ['Principal', 'Terraza'],
    'test-session-token',
    async (url, options) => {
      request = { url, options };
      return response(200, { success: true, zones: ['Principal', 'Terraza'] });
    }
  );

  assert.equal(request.url, '/api/tenant/profile');
  assert.equal(request.options.method, 'PATCH');
  assert.equal(request.options.headers.Authorization, 'Bearer test-session-token');
  assert.deepEqual(JSON.parse(request.options.body), { zones: ['Principal', 'Terraza'] });
  assert.deepEqual(savedZones, ['Principal', 'Terraza']);
});

test('rechaza la operación sin sesión y no realiza una petición', async () => {
  let calls = 0;
  await assert.rejects(
    persistTenantZones(['Principal'], null, async () => {
      calls++;
      return response(200, { success: true, zones: ['Principal'] });
    }),
    /No hay una sesión válida/
  );
  assert.equal(calls, 0);
});

test('propaga el error del endpoint cuando la actualización no fue aceptada', async () => {
  await assert.rejects(
    persistTenantZones(['Principal'], 'test-session-token', async () => response(500, {
      error: 'No se pudieron guardar los salones.'
    })),
    /No se pudieron guardar los salones/
  );
});

test('rechaza una respuesta exitosa sin confirmación de persistencia', async () => {
  await assert.rejects(
    persistTenantZones(['Principal'], 'test-session-token', async () => response(200, {
      success: false,
      zones: ['Principal']
    })),
    /HTTP 200/
  );
});

test('rechaza respuestas que no confirman la lista guardada', async () => {
  await assert.rejects(
    persistTenantZones(['Principal'], 'test-session-token', async () => response(200, {
      success: true
    })),
    /no confirmó la lista/
  );
});

test('propaga los errores de conexión', async () => {
  await assert.rejects(
    persistTenantZones(['Principal'], 'test-session-token', async () => {
      throw new Error('network unavailable');
    }),
    /network unavailable/
  );
});
