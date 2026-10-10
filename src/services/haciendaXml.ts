import { ElectronicInvoiceCR, TableItem, TenantInfo } from '../types';

/* ------------------------------------------------------------------ */
/*  Utilidades de fecha / clave / consecutivo (Hacienda CR)           */
/* ------------------------------------------------------------------ */

const r5 = (n: number) => Math.round((n + Number.EPSILON) * 100000) / 100000;
const f5 = (n: number) => r5(n).toFixed(5);

/** Partes de fecha en hora de Costa Rica (UTC-6, sin horario de verano). */
function crParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Formato exigido por Hacienda: yyyy-MM-ddTHH:mm:ss-06:00 (sin milisegundos ni "Z"). */
export function formatHaciendaDate(date: Date): string {
  const p = crParts(date);
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.mi}:${p.s}-06:00`;
}

export type TipoDocumentoCR = 'FE' | 'TE';

const TIPO_DOC_CODE: Record<TipoDocumentoCR, string> = { FE: '01', TE: '04' };

function seqKey(branch: string, terminal: string, tipo: TipoDocumentoCR) {
  return `saborai_hacienda_seq_${branch}_${terminal}_${tipo}`;
}

/** Siguiente número consecutivo SIN reservarlo (para vistas previas). */
export function peekConsecutivoNumber(branch: string, terminal: string, tipo: TipoDocumentoCR): number {
  try {
    return (parseInt(localStorage.getItem(seqKey(branch, terminal, tipo)) || '0', 10) || 0) + 1;
  } catch {
    return 1;
  }
}

/** Reserva (incrementa) y devuelve el siguiente consecutivo. */
export function reserveConsecutivoNumber(branch: string, terminal: string, tipo: TipoDocumentoCR): number {
  const next = peekConsecutivoNumber(branch, terminal, tipo);
  try {
    localStorage.setItem(seqKey(branch, terminal, tipo), String(next));
  } catch { /* ignore */ }
  return next;
}

export function randomSecurityCode(): string {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

/**
 * Normaliza la cédula del emisor a solo dígitos como la espera Hacienda.
 * Persona física: 9 dígitos (04-0188-0588 → 401880588). Jurídica: 10 dígitos (3-101-xxxxxx).
 * Un valor de 10 dígitos que empieza en 0 solo puede ser una física escrita con cero de provincia.
 */
export function normalizeCedula(raw: string): string {
  const d = (raw || '').replace(/[^0-9]/g, '');
  return d.length === 10 && d.startsWith('0') ? d.slice(1) : d;
}

/**
 * Convierte un código de actividad económica (CIIU v4) al formato de 6 dígitos del RUT.
 * El padrón de Hacienda los publica como "6201.0" → "620100"; "561001" se conserva.
 * Se rellena con ceros a la DERECHA (nunca a la izquierda).
 */
export function normalizeActividad(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 6 ? digits.slice(0, 6) : digits.padEnd(6, '0');
}

/**
 * Construye Clave (50 dígitos) y Número Consecutivo (20 dígitos) válidos.
 * Clave = 506 + DDMMYY + cédula(12) + consecutivo(20) + situación(1) + código seguridad(8)
 * Consecutivo = sucursal(3) + terminal(5) + tipoDoc(2) + número(10)
 */
export function buildClaveYConsecutivo(opts: {
  cedula: string;
  branchCode: string;
  terminalCode: string;
  tipo: TipoDocumentoCR;
  numero: number;
  fecha: Date;
  securityCode?: string;
}): { clave: string; consecutivo: string } {
  const onlyDigits = (s: string) => (s || '').replace(/[^0-9]/g, '');
  const p = crParts(opts.fecha);
  const consecutivo =
    onlyDigits(opts.branchCode).padStart(3, '0').slice(-3) +
    onlyDigits(opts.terminalCode).padStart(5, '0').slice(-5) +
    TIPO_DOC_CODE[opts.tipo] +
    String(opts.numero).padStart(10, '0').slice(-10);
  const clave =
    '506' +
    p.d + p.m + p.y.slice(-2) +
    normalizeCedula(opts.cedula).padStart(12, '0').slice(-12) +
    consecutivo +
    '1' +
    (opts.securityCode || randomSecurityCode());
  return { clave, consecutivo };
}

/* ------------------------------------------------------------------ */
/*  Validación previa al envío (evita rechazos "silenciosos")         */
/* ------------------------------------------------------------------ */

export function validateInvoiceForHacienda(invoice: ElectronicInvoiceCR, tenant?: TenantInfo): string | null {
  if (!/^\d{50}$/.test(invoice.clave50Digitos)) return 'La clave generada no tiene 50 dígitos numéricos.';
  if (!/^\d{20}$/.test(invoice.consecutivo)) return 'El número consecutivo no tiene 20 dígitos.';
  if (!invoice.items || invoice.items.length === 0) return 'La factura no tiene líneas de detalle.';
  for (const it of invoice.items) {
    const cabys = String(it.cabysCode || '').replace(/\D/g, '');
    if (cabys.length !== 13 || /^0+$/.test(cabys)) {
      return `El producto "${it.name}" no tiene un código CABYS válido (13 dígitos). Edítelo en Menú → Producto → CABYS.`;
    }
  }
  if (tenant && !tenant.cedulaJuridica) return 'Falta la cédula del emisor.';
  return null;
}

/* ------------------------------------------------------------------ */
/*  Generación XML v4.4                                                */
/* ------------------------------------------------------------------ */

const SERVICE_UNITS = ['Sp', 'Os', 'St', 'Spe', 'Al', 'Alq', 'Cm', 'I', 'Ft'];

function tarifaCode(rate: number): string {
  if (rate >= 0.13) return '08';
  if (rate >= 0.08) return '07';
  if (rate >= 0.04) return '04';
  if (rate >= 0.02) return '03';
  if (rate >= 0.01) return '02';
  if (rate >= 0.005) return '09';
  return '10'; // Tarifa exenta
}

function medioPagoCode(tipo: string): string {
  const t = tipo.toLowerCase();
  if (t.includes('sinpe')) return '06';
  if (t.includes('tarjeta')) return '02';
  if (t.includes('efectivo')) return '01';
  if (t.includes('cheque')) return '03';
  if (t.includes('transfer')) return '04';
  return '99';
}

export function generateHaciendaXmlV44(invoice: ElectronicInvoiceCR, tenant: TenantInfo): string {
  const fecha = invoice.fechaEmision ? new Date(invoice.fechaEmision as any) : new Date();
  const fechaEmision = formatHaciendaDate(isNaN(fecha.getTime()) ? new Date() : fecha);

  const hasReceptorId = !!(invoice.receptor?.identificacion || '').replace(/[^0-9]/g, '');
  const tipoDoc: TipoDocumentoCR = invoice.tipoDocumento || (hasReceptorId ? 'FE' : 'TE');
  const rootName = tipoDoc === 'FE' ? 'FacturaElectronica' : 'TiqueteElectronico';
  const ns = tipoDoc === 'FE' ? 'facturaElectronica' : 'tiqueteElectronico';

  const taxable = (invoice.iva13 + invoice.iva4 + invoice.iva2 + invoice.iva1) > 0;

  let totServGrav = 0, totServExe = 0, totMercGrav = 0, totMercExe = 0, totImp = 0;
  const desglose: Record<string, number> = {};

  const linesXml = invoice.items.map((item: TableItem, index: number) => {
    const cabys = String(item.cabysCode || '').replace(/\D/g, '').padStart(13, '0').slice(0, 13);
    const rate = taxable ? (item.taxRate || 0) : 0;
    const monto = r5(item.price * item.quantity);
    const impuesto = r5(monto * rate);
    const isService = cabys.startsWith('63');
    const unidad = isService ? 'Os' : 'Unid';

    if (rate > 0) {
      if (isService) totServGrav += monto; else totMercGrav += monto;
      totImp += impuesto;
      const code = tarifaCode(rate);
      desglose[code] = r5((desglose[code] || 0) + impuesto);
    } else {
      if (isService) totServExe += monto; else totMercExe += monto;
    }

    const impuestoXml = `
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifaIVA>${tarifaCode(rate)}</CodigoTarifaIVA>
        <Tarifa>${(rate * 100).toFixed(2)}</Tarifa>
        <Monto>${f5(impuesto)}</Monto>
      </Impuesto>`;

    return `
    <LineaDetalle>
      <NumeroLinea>${index + 1}</NumeroLinea>
      <Codigo>${cabys}</Codigo>
      <Cantidad>${Number(item.quantity).toFixed(3)}</Cantidad>
      <UnidadMedida>${unidad}</UnidadMedida>
      <Detalle>${escapeXml(String(item.name).slice(0, 200))}</Detalle>
      <PrecioUnitario>${f5(item.price)}</PrecioUnitario>
      <MontoTotal>${f5(monto)}</MontoTotal>
      <SubTotal>${f5(monto)}</SubTotal>
      <BaseImponible>${f5(monto)}</BaseImponible>${impuestoXml}
      <MontoTotalLinea>${f5(monto + impuesto)}</MontoTotalLinea>
    </LineaDetalle>`;
  }).join('');

  totServGrav = r5(totServGrav); totServExe = r5(totServExe);
  totMercGrav = r5(totMercGrav); totMercExe = r5(totMercExe); totImp = r5(totImp);
  const totGravado = r5(totServGrav + totMercGrav);
  const totExento = r5(totServExe + totMercExe);
  const totVenta = r5(totGravado + totExento);
  const otrosCargos = invoice.servicio10 > 0 ? r5(totVenta * 0.10) : 0;
  const totComprobante = r5(totVenta + totImp + otrosCargos);

  const emisorCedula = normalizeCedula(tenant.cedulaJuridica);
  const emisorTipoId = tenant.haciendaConfig?.tipoIdentificacion || '02';
  const codigoActividad = normalizeActividad(tenant.haciendaConfig?.codigoActividad || '561001');
  const proveedor = (tenant.haciendaConfig?.proveedorSistemas || emisorCedula).replace(/[^0-9]/g, '').padStart(12, '0');

  // Ubicación del emisor (debe coincidir con ATV): provincia 1 dígito, cantón 2, distrito 2
  const hc = tenant.haciendaConfig;
  const provincia = String(parseInt((hc?.provincia || '1').replace(/\D/g, '') || '1', 10)).slice(0, 1);
  const canton = (hc?.canton || '01').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const distrito = (hc?.distrito || '01').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const otrasSenas = (hc?.otrasSenas || tenant.location || 'San José, Costa Rica').trim();
  console.log('[Hacienda] Emisor.Ubicacion:', { provincia, canton, distrito, otrasSenas },
    '| CodigoActividadEmisor:', codigoActividad, '| Emisor:', emisorTipoId, emisorCedula);

  const esCredito = (invoice.condicionVenta as string).includes('Credito');
  const condicionVenta = esCredito ? '02' : '01';

  // Medios de pago (v4.4: dentro de ResumenFactura)
  let mediosPagoXml = '';
  if (!esCredito) {
    let pagos = (invoice.pagos || []).filter(p => p.monto > 0).map(p => ({ code: medioPagoCode(p.tipo), monto: r5(p.monto) }));
    if (pagos.length === 0) {
      pagos = [{ code: medioPagoCode(invoice.medioPago || ''), monto: totComprobante }];
    }
    // Ajustar para que la suma sea exactamente el total del comprobante
    const sum = r5(pagos.reduce((s, p) => s + p.monto, 0));
    pagos[pagos.length - 1].monto = r5(pagos[pagos.length - 1].monto + (totComprobante - sum));
    pagos = pagos.slice(0, 4);
    mediosPagoXml = pagos.map(p => `
    <MedioPago>
      <TipoMedioPago>${p.code}</TipoMedioPago>${p.code === '99' ? `
      <MedioPagoOtros>Otros</MedioPagoOtros>` : ''}
      <TotalMedioPago>${f5(p.monto)}</TotalMedioPago>
    </MedioPago>`).join('');
  }

  const desgloseXml = Object.entries(desglose).map(([code, monto]) => `
    <TotalDesgloseImpuesto>
      <Codigo>01</Codigo>
      <CodigoTarifaIVA>${code}</CodigoTarifaIVA>
      <TotalMontoImpuesto>${f5(monto)}</TotalMontoImpuesto>
    </TotalDesgloseImpuesto>`).join('');

  // Actividad del receptor: solo si el cliente la proporcionó y es un código válido de 6 dígitos (nunca valores dummy)
  const actRecCode = normalizeActividad(invoice.codigoActividadReceptor || '');
  const actRecValida = actRecCode.length === 6 && !/^0+$/.test(actRecCode);
  const actReceptorXml = tipoDoc === 'FE' && hasReceptorId && actRecValida
    ? `\n    <CodigoActividad>${actRecCode}</CodigoActividad>`
    : '';

  const receptorTipo = (invoice.receptor?.tipoIdentificacion || '01-Fisica').split('-')[0];
  const receptorXml = tipoDoc === 'FE' && hasReceptorId ? `
  <Receptor>
    <Nombre>${escapeXml(invoice.receptor.nombre)}</Nombre>
    <Identificacion>
      <Tipo>${receptorTipo}</Tipo>
      <Numero>${invoice.receptor.identificacion.replace(/[^0-9]/g, '')}</Numero>
    </Identificacion>${actReceptorXml}${invoice.receptor.correo ? `
    <CorreoElectronico>${escapeXml(invoice.receptor.correo)}</CorreoElectronico>` : ''}
  </Receptor>` : '';

  console.log('[Hacienda] Receptor:', hasReceptorId ? invoice.receptor?.identificacion : '(sin receptor)', '| CodigoActividadReceptor:', actReceptorXml ? actRecCode : '(no enviado)');

  const otrosCargosXml = otrosCargos > 0 ? `
  <OtrosCargos>
    <TipoDocumentoOC>06</TipoDocumentoOC>
    <Detalle>Impuesto de servicio 10%</Detalle>
    <PorcentajeOC>10.00000</PorcentajeOC>
    <MontoCargo>${f5(otrosCargos)}</MontoCargo>
  </OtrosCargos>` : '';

  const telefono = (tenant.phone || '').replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8);

  const finalXml = `<?xml version="1.0" encoding="utf-8"?>
<${rootName} xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Clave>${invoice.clave50Digitos}</Clave>
  <ProveedorSistemas>
    <NombreProveedor>${escapeXml(tenant.name)}</NombreProveedor>
    <VersionSoftware>Saborai 1.0</VersionSoftware>
  </ProveedorSistemas>
  <CodigoActividad>${codigoActividad}</CodigoActividad>
  <NumeroConsecutivo>${invoice.consecutivo}</NumeroConsecutivo>
  <FechaEmision>${fechaEmision}</FechaEmision>
  <Emisor>
    <Nombre>${escapeXml(tenant.name)}</Nombre>
    <Identificacion>
      <Tipo>${emisorTipoId}</Tipo>
      <Numero>${emisorCedula}</Numero>
    </Identificacion>
    <NombreComercial>${escapeXml(tenant.name)}</NombreComercial>
    <Ubicacion>
      <Provincia>${provincia}</Provincia>
      <Canton>${canton}</Canton>
      <Distrito>${distrito}</Distrito>
      <OtrasSenas>${escapeXml(otrasSenas)}</OtrasSenas>
    </Ubicacion>
    <Telefono>
      <CodigoPais>506</CodigoPais>
      <NumTelefono>${telefono}</NumTelefono>
    </Telefono>
    <CorreoElectronico>${escapeXml(tenant.email)}</CorreoElectronico>
  </Emisor>${receptorXml}
  <CondicionVenta>${condicionVenta}</CondicionVenta>${esCredito ? `
  <PlazoCredito>1</PlazoCredito>` : ''}
  <DetalleServicio>${linesXml}
  </DetalleServicio>${otrosCargosXml}
  <ResumenFactura>
    <CodigoTipoMoneda>
      <CodigoMoneda>${invoice.moneda}</CodigoMoneda>
      <TipoCambio>${f5(invoice.tipoCambio || 1)}</TipoCambio>
    </CodigoTipoMoneda>
    <TotalServGravados>${f5(totServGrav)}</TotalServGravados>
    <TotalServExentos>${f5(totServExe)}</TotalServExentos>
    <TotalMercanciasGravadas>${f5(totMercGrav)}</TotalMercanciasGravadas>
    <TotalMercanciasExentas>${f5(totMercExe)}</TotalMercanciasExentas>
    <TotalGravado>${f5(totGravado)}</TotalGravado>
    <TotalExento>${f5(totExento)}</TotalExento>
    <TotalVenta>${f5(totVenta)}</TotalVenta>
    <TotalDescuentos>0.00000</TotalDescuentos>
    <TotalVentaNeta>${f5(totVenta)}</TotalVentaNeta>${desgloseXml}
    <TotalImpuesto>${f5(totImp)}</TotalImpuesto>
    <TotalOtrosCargos>${f5(otrosCargos)}</TotalOtrosCargos>${mediosPagoXml}
    <TotalComprobante>${f5(totComprobante)}</TotalComprobante>
  </ResumenFactura>
</${rootName}>`;

  // Log para visualizar visualmente que MontoTotalLinea quedó al final
  console.log('=== XML GENERADO V4.4 ===');
  console.log(finalXml);
  
  return finalXml;
}

/** @deprecated Mantenido por compatibilidad; ahora genera esquema v4.4. */
export const generateHaciendaXmlV43 = generateHaciendaXmlV44;

function escapeXml(unsafe: string): string {
  return String(unsafe ?? '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function downloadXmlFile(xmlContent: string, filename: string) {
  const blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
