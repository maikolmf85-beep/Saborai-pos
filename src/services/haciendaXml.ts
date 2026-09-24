import { ElectronicInvoiceCR, TableItem, TenantInfo } from '../types';

export function generateHaciendaXmlV43(
  invoice: ElectronicInvoiceCR,
  tenant: TenantInfo
): string {
  const currentDate = new Date().toISOString();
  
  const linesXml = invoice.items.map((item: TableItem, index: number) => {
    const totalMontoLinea = item.price * item.quantity;
    const montoImpuesto = totalMontoLinea * item.taxRate;
    const totalLinea = totalMontoLinea + montoImpuesto;

    return `
    <LineaDetalle>
      <NumeroLinea>${index + 1}</NumeroLinea>
      <CodigoCABYS>${item.cabysCode}</CodigoCABYS>
      <CodigoTipo>04</CodigoTipo>
      <Codigo>${item.id}</Codigo>
      <Cantidad>${item.quantity}.000</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <Detalle>${escapeXml(item.name)}</Detalle>
      <PrecioUnitario>${item.price.toFixed(5)}</PrecioUnitario>
      <MontoTotal>${totalMontoLinea.toFixed(5)}</MontoTotal>
      <SubTotal>${totalMontoLinea.toFixed(5)}</SubTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifa>08</CodigoTarifa>
        <Tarifa>${(item.taxRate * 100).toFixed(2)}</Tarifa>
        <Monto>${montoImpuesto.toFixed(5)}</Monto>
      </Impuesto>
      <MontoTotalLinea>${totalLinea.toFixed(5)}</MontoTotalLinea>
    </LineaDetalle>`;
  }).join('');

  const emisorTipoId = tenant.haciendaConfig?.tipoIdentificacion || '02';
  const codigoActividad = tenant.haciendaConfig?.codigoActividad || '561001';

  return `<?xml version="1.0" encoding="utf-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Clave>${invoice.clave50Digitos}</Clave>
  <CodigoActividad>${codigoActividad}</CodigoActividad>
  <NumeroConsecutivo>${invoice.consecutivo}</NumeroConsecutivo>
  <FechaEmision>${currentDate}</FechaEmision>
  <Emisor>
    <Nombre>${escapeXml(tenant.name)}</Nombre>
    <Identificacion>
      <Tipo>${emisorTipoId}</Tipo>
      <Numero>${tenant.cedulaJuridica.replace(/[^0-9]/g, '')}</Numero>
    </Identificacion>
    <NombreComercial>${escapeXml(tenant.name)}</NombreComercial>
    <Ubicacion>
      <Provincia>1</Provincia>
      <Canton>01</Canton>
      <Distrito>01</Distrito>
      <Barrio>01</Barrio>
      <OtrasSenas>${escapeXml(tenant.location || 'San José, Costa Rica')}</OtrasSenas>
    </Ubicacion>
    <Telefono>
      <CodigoPais>506</CodigoPais>
      <NumTelefono>${tenant.phone.replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8)}</NumTelefono>
    </Telefono>
    <CorreoElectronico>${tenant.email}</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>${escapeXml(invoice.receptor.nombre)}</Nombre>
    <Identificacion>
      <Tipo>01</Tipo>
      <Numero>${invoice.receptor.identificacion.replace(/[^0-9]/g, '')}</Numero>
    </Identificacion>
    <CorreoElectronico>${invoice.receptor.correo}</CorreoElectronico>
  </Receptor>
  <CondicionVenta>${invoice.condicionVenta.split('-')[0]}</CondicionVenta>
  <PlazoCredito>0</PlazoCredito>
  <MedioPago>${invoice.medioPago.split('-')[0]}</MedioPago>
  <DetalleServicio>${linesXml}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda>
      <CodigoMoneda>${invoice.moneda}</CodigoMoneda>
      <TipoCambio>1.00000</TipoCambio>
    </CodigoTipoMoneda>
    <TotalServGravados>${invoice.subtotal.toFixed(5)}</TotalServGravados>
    <TotalServExentos>0.00000</TotalServExentos>
    <TotalGravado>${invoice.subtotal.toFixed(5)}</TotalGravado>
    <TotalExento>0.00000</TotalExento>
    <TotalVenta>${invoice.subtotal.toFixed(5)}</TotalVenta>
    <TotalDescuentos>0.00000</TotalDescuentos>
    <TotalVentaNeta>${invoice.subtotal.toFixed(5)}</TotalVentaNeta>
    <TotalImpuesto>${invoice.iva13.toFixed(5)}</TotalImpuesto>
    <TotalOtrosCargos>
      <OtrosCargos>
        <TipoDocumento>06</TipoDocumento>
        <Detalle>Servicio de Mesa 10% Ley Costa Rica</Detalle>
        <MontoCargo>${invoice.servicio10.toFixed(5)}</MontoCargo>
      </OtrosCargos>
    </TotalOtrosCargos>
    <TotalComprobante>${invoice.totalComprobante.toFixed(5)}</TotalComprobante>
  </ResumenFactura>
</FacturaElectronica>`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
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
