import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scheduleGuidedTour } from '../src/services/guidedTourScheduler.ts';

function createFakeScheduler() {
  let nextId = 1;
  const timers = new Map();

  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay, cancelled: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cancelled = true;
    },
    get activeCount() {
      return [...timers.values()].filter(timer => !timer.cancelled).length;
    },
    runPending() {
      for (const timer of timers.values()) {
        if (timer.cancelled) continue;
        timer.cancelled = true;
        timer.callback();
      }
    },
    get delays() {
      return [...timers.values()].map(timer => timer.delay);
    }
  };
}

test('el doble montaje/limpieza de StrictMode deja un solo inicio pendiente del tutorial', () => {
  const scheduler = createFakeScheduler();
  let starts = 0;

  // React StrictMode en desarrollo ejecuta setup -> cleanup -> setup.
  const cleanupFirstMount = scheduleGuidedTour(() => { starts += 1; }, scheduler);
  cleanupFirstMount();
  const cleanupSecondMount = scheduleGuidedTour(() => { starts += 1; }, scheduler);

  assert.equal(scheduler.activeCount, 1);
  assert.deepEqual(scheduler.delays, [1500, 1500]);
  scheduler.runPending();
  assert.equal(starts, 1);
  cleanupSecondMount();
});

test('GuidedTour usa y devuelve el cleanup del programador cancelable', async () => {
  const source = await readFile(new URL('../src/components/GuidedTour.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ scheduleGuidedTour \} from '\.\.\/services\/guidedTourScheduler';/);
  assert.match(source, /return scheduleGuidedTour\(\(\) => \{/);
  assert.match(source, /driverObj\.drive\(\);\s*\}\);/);
});
