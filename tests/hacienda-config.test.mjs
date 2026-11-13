import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptHaciendaConfig,
  encryptHaciendaConfig,
  mergeHaciendaConfig,
  normalizeHaciendaBranchCode,
  publicHaciendaConfig
} from '../api/_utils/haciendaConfig.ts';

const previousKey = process.env.HACIENDA_CONFIG_ENCRYPTION_KEY;
const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
beforeEach(() => { process.env.HACIENDA_CONFIG_ENCRYPTION_KEY = testKey; });
after(() => {
  if (previousKey === undefined) delete process.env.HACIENDA_CONFIG_ENCRYPTION_KEY;
  else process.env.HACIENDA_CONFIG_ENCRYPTION_KEY = previousKey;
});

test('cifra y descifra un perfil Hacienda dentro del tenant y sucursal correctos', () => {
  const original = {
    environment: 'production',
    atvUsername: 'cpj-example@comprobanteselectronicos.go.cr',
    atvPassword: ' contraseña ATV con espacios ',
    pinP12: '00012345678901',
    p12Base64: 'base64-test',
    cedulaEmisor: '3101234567'
  };
  const encrypted = encryptHaciendaConfig(original, 'tenant-A', '001');
  assert.deepEqual(decryptHaciendaConfig(encrypted, 'tenant-A', '001'), original);
  assert.throws(() => decryptHaciendaConfig(encrypted, 'tenant-B', '001'));
  assert.throws(() => decryptHaciendaConfig(encrypted, 'tenant-A', '002'));
});

test('la respuesta pública nunca incluye contraseña, PIN, certificado ni usuario sin enmascarar', () => {
  const safe = publicHaciendaConfig({
    environment: 'sandbox',
    atvUsername: 'cpj-example@stag.comprobanteselectronicos.go.cr',
    atvPassword: 'do-not-return',
    pinP12: 'do-not-return',
    p12Base64: 'do-not-return',
    isValidated: true
  });
  assert.equal(safe.atvUsernameConfigured, true);
  assert.equal(safe.atvPasswordConfigured, true);
  assert.equal(safe.certificateConfigured, true);
  assert.equal(safe.isValidated, true);
  assert.match(String(safe.atvUsernameMasked), /^cpj•••.{1,8}$/);
  assert.notEqual(safe.atvUsernameMasked, 'cpj-example@stag.comprobanteselectronicos.go.cr');
  assert.equal('atvUsername' in safe, false);
  assert.equal('atvPassword' in safe, false);
  assert.equal('pinP12' in safe, false);
  assert.equal('p12Base64' in safe, false);
});

test('merge conserva literalmente credenciales/PIN válidos y permite reemplazo o eliminación explícita', () => {
  const existing = {
    environment: 'sandbox',
    atvUsername: 'user@example.go.cr',
    atvPassword: ' secret with spaces ',
    pinP12: '0427',
    p12Base64: 'certificate-old',
    isValidated: true
  };
  const updated = mergeHaciendaConfig(existing, { cedulaEmisor: '3101234567' });
  assert.equal(updated.atvPassword, ' secret with spaces ');
  assert.equal(updated.pinP12, '0427');
  assert.equal(updated.isValidated, false);

  const replacement = mergeHaciendaConfig(updated, { atvPassword: ' new secret ' });
  assert.equal(replacement.atvPassword, ' new secret ');

  const removed = mergeHaciendaConfig(replacement, {}, { removeCertificate: true });
  assert.equal(removed.pinP12, '');
  assert.equal(removed.p12Base64, '');
  assert.equal(removed.p12FileName, '');
});

test('normaliza el código de sucursal antes de vincular el cifrado', () => {
  assert.equal(normalizeHaciendaBranchCode('1'), '001');
  assert.equal(normalizeHaciendaBranchCode('001'), '001');
  assert.equal(normalizeHaciendaBranchCode('1000'), null);
});

const { DOMParser } = await import('@xmldom/xmldom');
const { validateHaciendaXmlDocumentAgainstBranchProfile } = await import('../api/_utils/haciendaXmlValidation.ts');

const xmlClaveFixture = '1'.repeat(50);
const xmlConsecutivoFixture = '2'.repeat(20);
const xmlProfileFixture = {
  environment: 'sandbox',
  cedulaEmisor: '3101234567',
  codigoActividad: '123456',
  proveedorSistemas: '310123456',
  provincia: '1',
  canton: '1',
  distrito: '1',
  otrasSenas: 'Calle 1'
};
function invoiceXmlFixture(prefix = '') {
  const name = (local) => prefix ? `${prefix}:${local}` : local;
  const declaration = prefix ? `xmlns:${prefix}` : 'xmlns';
  return `<${name('FacturaElectronica')} ${declaration}="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica">
    <${name('Clave')}>${xmlClaveFixture}</${name('Clave')}>
    <${name('NumeroConsecutivo')}>${xmlConsecutivoFixture}</${name('NumeroConsecutivo')}>
    <${name('CodigoActividadEmisor')}>123456</${name('CodigoActividadEmisor')}>
    <${name('ProveedorSistemas')}>000310123456</${name('ProveedorSistemas')}>
    <${name('Emisor')}>
      <${name('Identificacion')}><${name('Numero')}>3101234567</${name('Numero')}></${name('Identificacion')}>
      <${name('Ubicacion')}>
        <${name('Provincia')}>1</${name('Provincia')}>
        <${name('Canton')}>01</${name('Canton')}>
        <${name('Distrito')}>01</${name('Distrito')}>
        <${name('OtrasSenas')}> Calle   1 </${name('OtrasSenas')}>
      </${name('Ubicacion')}>
    </${name('Emisor')}>
  </${name('FacturaElectronica')}>`;
}

test('valida XML Hacienda v4.4 con namespace por defecto o con prefijo', () => {
  for (const prefix of ['', 'h']) {
    const document = new DOMParser().parseFromString(invoiceXmlFixture(prefix), 'application/xml');
    assert.equal(
      validateHaciendaXmlDocumentAgainstBranchProfile(document, xmlProfileFixture, xmlClaveFixture, xmlConsecutivoFixture),
      null
    );
  }
});

test('rechaza proveedor de sistemas con más de 12 dígitos en el perfil', () => {
  const document = new DOMParser().parseFromString(invoiceXmlFixture('h'), 'application/xml');
  assert.match(
    String(validateHaciendaXmlDocumentAgainstBranchProfile(
      document,
      { ...xmlProfileFixture, proveedorSistemas: '1234567890123' },
      xmlClaveFixture,
      xmlConsecutivoFixture
    )),
    /proveedor de sistemas/
  );
});

test('un guardado sin cambios críticos conserva validación y cambiar el ambiente la reinicia', () => {
  const validated = {
    environment: 'sandbox',
    atvUsername: 'synthetic-user@example.test',
    atvPassword: 'synthetic-password',
    pinP12: '0427',
    p12Base64: 'synthetic-certificate',
    cedulaEmisor: '3101234567',
    tipoIdentificacion: '02',
    codigoActividad: '123456',
    provincia: '1',
    canton: '01',
    distrito: '01',
    otrasSenas: 'Calle 1',
    proveedorSistemas: '310123456',
    sucursal: '001',
    terminal: '00001',
    isValidated: true
  };
  assert.equal(mergeHaciendaConfig(validated, {}).isValidated, true);
  assert.equal(mergeHaciendaConfig(validated, { environment: 'production' }).isValidated, false);
});
