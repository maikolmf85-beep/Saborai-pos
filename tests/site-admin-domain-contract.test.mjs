import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const sitemap = read('../public/sitemap.xml');
const robots = read('../public/robots.txt');
const app = read('../src/App.tsx');
const backoffice = read('../src/components/SuperAdminBackoffice.tsx');
const adminMetrics = read('../api/admin/metrics.ts');

test('la metadata SEO de la landing usa el dominio oficial, no el del POS', () => {
  assert.match(html, /rel="canonical" href="https:\/\/saborai\.site\/"/);
  assert.match(html, /property="og:url" content="https:\/\/saborai\.site\/"/);
  assert.match(html, /"url": "https:\/\/saborai\.site"/);
  assert.doesNotMatch(html, /https:\/\/pos\.saborai\.site/);
});

test('sitemap y robots anuncian saborai.site y mantienen URLs del POS fuera del sitemap', () => {
  assert.match(sitemap, /<loc>https:\/\/saborai\.site\//);
  assert.doesNotMatch(sitemap, /pos\.saborai\.site/);
  assert.match(robots, /Sitemap: https:\/\/saborai\.site\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Sitemap: https:\/\/pos\.saborai\.site/);
});

test('el host admin recibe noindex,nofollow sin cambiar la directiva inicial de la landing', () => {
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.match(html, /hostname\.toLowerCase\(\) === 'admin\.saborai\.site'/);
  assert.match(html, /setAttribute\('content', 'noindex, nofollow'\)/);
  assert.match(html, /querySelector\('link\[rel="canonical"\]'\)\?\.remove\(\)/);
});

test('el POS no monta el backoffice global y enlaza al dominio administrativo dedicado', () => {
  const settings = read('../src/components/SettingsModal.tsx');
  assert.doesNotMatch(settings, /<SuperAdminBackoffice/);
  assert.doesNotMatch(settings, /setActiveSection\('admin'\)/);
  assert.match(settings, /href="https:\/\/admin\.saborai\.site"/);
});

test('la selección de vistas conserva landing, panel admin y POS en sus hosts previstos', () => {
  assert.match(app, /hostname === 'saborai\.site' \|\| hostname === 'www\.saborai\.site'/);
  assert.match(app, /hostname === 'admin\.saborai\.site'/);
  assert.match(app, /return 'POS';/);
  assert.match(app, /'https:\/\/pos\.saborai\.site\?demo=true' : 'https:\/\/pos\.saborai\.site'/);
});

test('el panel global no usa localStorage ni ofrece mutaciones y autoriza antes de consultar tenants', () => {
  assert.match(backoffice, /solo lectura/i);
  assert.doesNotMatch(backoffice, /localStorage|setTenantsList|impersonar/i);
  assert.match(adminMetrics, /auth\.employeeId \|\| !isGlobalAdminUser/);
  assert.ok(adminMetrics.indexOf('isGlobalAdminUser') < adminMetrics.indexOf(".from('tenants')"));
});
