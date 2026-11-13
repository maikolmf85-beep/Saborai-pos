import type { HaciendaBranchConfig } from './haciendaConfig.js';

function localName(node: any): string {
  const name = String(node?.localName || node?.nodeName || '');
  return name.split(':').pop() || '';
}

function descendantsByLocalName(parent: any, wantedName: string): any[] {
  const found: any[] = [];
  const stack: any[] = [];
  const children = parent?.childNodes;
  if (children) {
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children.item(index));
  }
  while (stack.length) {
    const node = stack.pop();
    if (node?.nodeType === 1 && localName(node) === wantedName) found.push(node);
    const nested = node?.childNodes;
    if (nested) {
      for (let index = nested.length - 1; index >= 0; index -= 1) stack.push(nested.item(index));
    }
  }
  return found;
}

function xmlText(parent: any, tagName: string): string {
  const node = descendantsByLocalName(parent, tagName)[0];
  return String(node?.textContent || '').trim();
}

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function fiscalCode(value: unknown, length: number): string {
  const raw = digits(value);
  return raw.length > 0 && raw.length <= length ? raw.padStart(length, '0') : '';
}

function normalizeFiscalText(value: unknown): string {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function validateHaciendaXmlDocumentAgainstBranchProfile(
  document: any,
  config: HaciendaBranchConfig,
  expectedClave: string,
  expectedConsecutivo: string
): string | null {
  try {
    const root = document?.documentElement;
    if (!root) return 'El comprobante no contiene un XML válido.';
    const namespace = String(root.namespaceURI || '');
    if (!namespace.includes('/v4.4/')) return 'El XML debe usar el esquema oficial Hacienda v4.4.';
    if (xmlText(document, 'Clave') !== expectedClave) return 'La clave del XML no coincide con la clave del comprobante.';
    if (xmlText(document, 'NumeroConsecutivo') !== expectedConsecutivo) return 'El consecutivo del XML no coincide con el comprobante.';

    const activity = digits(config.codigoActividad);
    if (activity.length !== 6 || digits(xmlText(document, 'CodigoActividadEmisor')) !== activity) {
      return 'La actividad económica del XML no coincide con la registrada para esta sucursal.';
    }

    const rawProvider = digits(config.proveedorSistemas || config.cedulaEmisor);
    const xmlProvider = digits(xmlText(document, 'ProveedorSistemas'));
    if (!rawProvider || rawProvider.length > 12 || xmlProvider.length !== 12 || xmlProvider !== rawProvider.padStart(12, '0')) {
      return 'El proveedor de sistemas del XML no coincide con el perfil de esta sucursal.';
    }

    const issuer = descendantsByLocalName(document, 'Emisor')[0];
    const identification = descendantsByLocalName(issuer, 'Identificacion')[0];
    const issuerNumber = digits(xmlText(identification, 'Numero')).replace(/^0+/, '');
    const savedIssuer = digits(config.cedulaEmisor).replace(/^0+/, '');
    if (!issuerNumber || issuerNumber !== savedIssuer) return 'La cédula del XML no coincide con el perfil de esta sucursal.';

    const location = descendantsByLocalName(issuer, 'Ubicacion')[0];
    const province = fiscalCode(config.provincia, 1);
    const canton = fiscalCode(config.canton, 2);
    const district = fiscalCode(config.distrito, 2);
    if (!province || digits(xmlText(location, 'Provincia')) !== province ||
        !canton || fiscalCode(xmlText(location, 'Canton'), 2) !== canton ||
        !district || fiscalCode(xmlText(location, 'Distrito'), 2) !== district ||
        normalizeFiscalText(xmlText(location, 'OtrasSenas')) !== normalizeFiscalText(config.otrasSenas)) {
      return 'La ubicación del XML no coincide con la dirección fiscal de esta sucursal.';
    }
    return null;
  } catch {
    return 'No se pudo leer el XML del comprobante para validar su perfil fiscal.';
  }
}
