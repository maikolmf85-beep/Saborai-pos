import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeUpdateActivated,
  markUpdateActivated,
  UPDATE_SUCCESS_SESSION_KEY,
  watchForActiveController,
  watchServiceWorkerUpdateDownload
} from '../src/services/pwaUpdateFlow.ts';

class FakeWorker extends EventTarget {
  state;

  constructor(state) {
    super();
    this.state = state;
  }

  setState(state) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing = null;

  findUpdate(worker) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('no muestra la barra en una instalación inicial sin worker controlador previo', () => {
  const registration = new FakeRegistration();
  const states = [];
  const stop = watchServiceWorkerUpdateDownload(registration, () => false, value => states.push(value));

  registration.findUpdate(new FakeWorker('installing'));

  assert.deepEqual(states, []);
  stop();
  assert.deepEqual(states, [false]);
});

test('usa el estado installing/installed real para abrir y cerrar el progreso indeterminado', () => {
  const registration = new FakeRegistration();
  const worker = new FakeWorker('installing');
  const states = [];
  const stop = watchServiceWorkerUpdateDownload(registration, () => true, value => states.push(value));

  registration.findUpdate(worker);
  assert.deepEqual(states, [true]);

  worker.setState('installed');
  assert.deepEqual(states, [true, false]);
  stop();
});

test('solo confirma la activación cuando el worker esperado está activo y controla la página', () => {
  const previousWorker = new FakeWorker('activated');
  const nextWorker = new FakeWorker('installed');
  const container = new EventTarget();
  container.controller = previousWorker;
  let confirmations = 0;
  watchForActiveController(nextWorker, container, () => { confirmations += 1; });

  nextWorker.setState('activated');
  assert.equal(confirmations, 0, 'activar sin controlar la página no basta');

  container.controller = nextWorker;
  container.dispatchEvent(new Event('controllerchange'));
  assert.equal(confirmations, 1);

  container.dispatchEvent(new Event('controllerchange'));
  nextWorker.setState('activated');
  assert.equal(confirmations, 1, 'la confirmación sucede solo una vez');
});

test('el aviso de éxito requiere un marcador de activación y se consume una sola vez', () => {
  const storage = new MemoryStorage();
  assert.equal(consumeUpdateActivated(storage), false);

  markUpdateActivated(storage);
  assert.equal(storage.getItem(UPDATE_SUCCESS_SESSION_KEY), 'activated');
  assert.equal(consumeUpdateActivated(storage), true);
  assert.equal(consumeUpdateActivated(storage), false);
});
