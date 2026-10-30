import React, { useState, useEffect } from 'react';
import { getTenantItem, setTenantItem } from '../services/tenantStorage';
import { 
  Printer, 
  Send, 
  ShieldCheck, 
  Building2, 
  Copy, 
  Check, 
  Download, 
  Code, 
  SplitSquareVertical,
  CheckCircle2,
  ArrowRightLeft,
  Plus,
  X,
  Receipt,
  LockKeyhole,
  Search,
  Save,
  ChevronLeft,
  Banknote,
  Share2,
  MessageCircle,
  WifiOff
} from 'lucide-react';
import { Table, TableItem, TenantInfo, ElectronicInvoiceCR, SubAccount, UserProfile } from '../types';
import { generateHaciendaXmlV44, downloadXmlFile, buildClaveYConsecutivo, peekConsecutivoNumber, reserveConsecutivoNumber, randomSecurityCode } from '../services/haciendaXml';
import { cashShiftService } from '../services/cashShiftService';
import { haciendaService } from '../services/haciendaService';
import { inventoryService } from '../services/inventoryService';
import { printerService } from '../services/printerService';
import { soundService } from '../services/soundEffects';
import { PosNotification } from './NotificationToast';

interface BillingHaciendaProps {
  tenant: TenantInfo;
  currentUser?: UserProfile | null;
  selectedTable?: Table | null;
  onEmitInvoice?: (invoice: ElectronicInvoiceCR) => void;
  onSaveTable?: (updatedTable: Table) => void;
  onRegisterPayment?: (payload: {
    table: Table;
    invoice: ElectronicInvoiceCR;
    paymentMethod: '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito';
    total: number;
    closeOrder: boolean;
    items: Array<{ name: string; quantity: number; menuItemId?: string }>;
  }) => void;
  onOpenCashShift?: (initialTab?: 'status' | 'close') => void;
  onOpenHaciendaHistory?: () => void;
  onNotify?: (notif: PosNotification) => void;
  onBackToTables?: () => void;
}

export const BillingHacienda: React.FC<BillingHaciendaProps> = ({
  tenant,
  currentUser,
  selectedTable,
  onEmitInvoice,
  onSaveTable,
  onRegisterPayment,
  onOpenCashShift,
  onOpenHaciendaHistory,
  onNotify,
  onBackToTables
}) => {
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [copiedClave, setCopiedClave] = useState(false);
  const [isInvoiceEmitted, setIsInvoiceEmitted] = useState(false);
  const [showXmlModal, setShowXmlModal] = useState(false);
  const [transferToast, setTransferToast] = useState<string | null>(null);

  // Subaccounts list state
  const defaultSubs: SubAccount[] = selectedTable?.activeOrder?.subAccounts?.length
    ? selectedTable.activeOrder.subAccounts
    : [
        { id: 1, name: 'Cuenta 1' }
      ];
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>(defaultSubs);
  const [selectedSubAccount, setSelectedSubAccount] = useState<number | 'ALL'>('ALL');

  // Items state (empty by default, no mock dishes)
  const fallbackItems: TableItem[] = [];

  const [orderItems, setOrderItems] = useState<TableItem[]>(
    selectedTable?.activeOrder?.items?.length ? selectedTable.activeOrder.items : fallbackItems
  );

  // Transfer item modal/popover state
  const [itemToTransfer, setItemToTransfer] = useState<TableItem | null>(null);
  const [transferTargetSubId, setTransferTargetSubId] = useState<number>(2);
  const [transferQty, setTransferQty] = useState<number>(1);

  // Sync state if selectedTable changes
  useEffect(() => {
    if (selectedTable?.activeOrder?.items?.length) {
      setOrderItems(selectedTable.activeOrder.items);
    }
    if (selectedTable?.activeOrder?.subAccounts?.length) {
      setSubAccounts(selectedTable.activeOrder.subAccounts);
    }
  }, [selectedTable]);

  // Customer form state
  const [isFacturaElectronica, setIsFacturaElectronica] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerCedula, setCustomerCedula] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerActivityCode, setCustomerActivityCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito'>('02-Tarjeta');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [isSearchingHacienda, setIsSearchingHacienda] = useState(false);
  const [includeService10, setIncludeService10] = useState(tenant.includeService10ByDefault ?? true);
  const [savedCustomers, setSavedCustomers] = useState<Array<{ cedula: string; name: string; email?: string; activityCode?: string }>>(() => {
    try {
      return getTenantItem<Array<{ cedula: string; name: string; email?: string; activityCode?: string }>>('customers', tenant.id) || [];
    } catch { return []; }
  });

  useEffect(() => {
    setSavedCustomers(getTenantItem<Array<{ cedula: string; name: string; email?: string; activityCode?: string }>>('customers', tenant.id) || []);
  }, [tenant.id]);

  // Filter items based on active subaccount tab
  const activeItems: TableItem[] = selectedSubAccount === 'ALL'
    ? orderItems
    : orderItems.filter(i => (i.subAccountId || 1) === selectedSubAccount);

  const isSimplified = tenant.taxRegime === 'SIMPLIFIED';
  const subtotal = activeItems.reduce((sum, it) => sum + (it.price * it.quantity), 0);
  const iva13 = isSimplified ? 0 : Math.round(subtotal * 0.13);
  const servicio10 = includeService10 ? Math.round(subtotal * 0.10) : 0;
  const total = Math.round(subtotal + iva13 + servicio10);
  const currentRegister = cashShiftService.getCurrentRegister();
  const currentShift = cashShiftService.getActiveShift();
  const isExecutiveOrder = Boolean(selectedTable?.activeOrder?.executiveEmployeeId);
  const terminalCode = currentRegister.terminalCode || '00001';
  const branchCode = currentRegister.branchCode || '001';
  const genericServerNames = new Set(['Mesero General', 'Salonero general', 'Salonero General', 'Mesero', 'Salonero']);
  const effectiveServerName = selectedTable?.activeOrder?.server && !genericServerNames.has(selectedTable.activeOrder.server)
    ? selectedTable.activeOrder.server
    : currentUser?.name || 'Salonero Encargado';

  useEffect(() => {
    if (isExecutiveOrder) setPaymentMethod('04-Credito');
  }, [isExecutiveOrder, selectedTable?.id]);

  // Clave y consecutivo válidos (50 / 20 dígitos). La vista previa no consume consecutivo; se reserva al emitir.
  const docType: 'FE' | 'TE' = isFacturaElectronica ? 'FE' : 'TE';
  const [previewDate] = useState(() => new Date());
  const [previewSecurity] = useState(() => randomSecurityCode());
  const [emittedInfo, setEmittedInfo] = useState<{ clave: string; consecutivo: string; fecha: Date; tipo: 'FE' | 'TE' } | null>(null);
  let savedLocalHc: any = null;
  try {
    const saved = getTenantItem<any>('hacienda_config', tenant.id);
    if (saved) savedLocalHc = saved;
  } catch {}
  const effectiveCedula = savedLocalHc?.cedulaEmisor || tenant.haciendaConfig?.cedulaEmisor || tenant.cedulaJuridica;
  const activeDocType = emittedInfo?.tipo ?? docType;

  const claveInfo = emittedInfo ?? {
    ...buildClaveYConsecutivo({
      cedula: effectiveCedula,
      branchCode,
      terminalCode,
      tipo: docType,
      numero: peekConsecutivoNumber(branchCode, terminalCode, docType),
      fecha: previewDate,
      securityCode: previewSecurity
    }),
    fecha: previewDate,
    tipo: docType
  };
  const clave50Digitos = claveInfo.clave;
  const consecutivo = claveInfo.consecutivo;

  const handleSearchHacienda = async () => {
    if (!customerCedula || customerCedula.length < 9) {
      if (onNotify) onNotify({ id: Date.now().toString(), type: 'HACIENDA_UPDATE', title: 'Cédula inválida', message: 'Ingrese una cédula válida (ej. 101230456 o 3101123456)', timestamp: new Date() });
      return;
    }
    setIsSearchingHacienda(true);
    try {
      // Check local saved customers first
      const customers = getTenantItem<Array<{ cedula: string; name: string; email?: string; activityCode?: string }>>('customers', tenant.id) || [];
      if (customers.length > 0) {
        const found = customers.find((c: any) => c.cedula.replace(/[-]/g, '') === customerCedula.replace(/[-]/g, ''));
        if (found) {
          setCustomerName(found.name || '');
          setCustomerEmail(found.email || '');
          setCustomerActivityCode(found.activityCode || '');
          setIsSearchingHacienda(false);
          if (onNotify) onNotify({ id: Date.now().toString(), type: 'HACIENDA_UPDATE', title: 'Cliente Encontrado', message: 'Datos cargados desde clientes guardados', timestamp: new Date() });
          return;
        }
      }

      // Fetch from Hacienda
      const res = await fetch(`https://api.hacienda.go.cr/fe/ae?identificacion=${customerCedula.replace(/[-]/g, '')}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      
      const fetchedName = data.nombre || '';
      const fetchedActivity = data.actividades && data.actividades.length > 0 ? data.actividades[0].codigo || '' : '';
      setCustomerName(fetchedName);
      setCustomerActivityCode(fetchedActivity);

      // Guardar en la caché local para modo offline resiliente
      try {
        const cleanCed = customerCedula.replace(/[-]/g, '');
        const updatedList = [
          {
            cedula: cleanCed,
            name: fetchedName,
            email: customerEmail || '',
            activityCode: fetchedActivity
          },
          ...savedCustomers.filter(c => c.cedula !== cleanCed)
        ].slice(0, 30);
        setSavedCustomers(updatedList);
        setTenantItem('customers', updatedList, tenant.id);
      } catch {}

      if (onNotify) onNotify({ id: Date.now().toString(), type: 'HACIENDA_UPDATE', title: 'Hacienda CR', message: 'Datos extraídos correctamente del padrón y guardados localmente', timestamp: new Date() });
    } catch (err) {
      if (onNotify) onNotify({ id: Date.now().toString(), type: 'HACIENDA_UPDATE', title: 'No encontrado', message: 'No se encontró el contribuyente en Hacienda', timestamp: new Date() });
    } finally {
      setIsSearchingHacienda(false);
    }
  };

  const handleShareWhatsApp = () => {
    const restaurantName = tenant.name || 'SaborAI POS';
    const docTitle = isSimplified 
      ? `Comprobante N° ${consecutivo}` 
      : isFacturaElectronica 
      ? `Factura Electrónica N° ${consecutivo}` 
      : `Tiquete Electrónico N° ${consecutivo}`;

    const itemsSummary = activeItems.map(i => `• ${i.quantity}x ${i.name} (₡${(i.price * i.quantity).toLocaleString()})`).join('\n');

    const message = `🧾 *${restaurantName}*
Hola *${customerName || 'Cliente'}*, aquí está el detalle de tu comprobante digital:
📄 *${docTitle}*
${!isSimplified && clave50Digitos ? `🔑 Clave DGT: \`${clave50Digitos}\`\n` : ''}
*Detalle de Consumo:*
${itemsSummary}

Subtotal: ₡${subtotal.toLocaleString()}
${!isSimplified ? `IVA 13%: ₡${iva13.toLocaleString()}\n` : ''}${servicio10 > 0 ? `10% Servicio de Mesa: ₡${servicio10.toLocaleString()}\n` : ''}*TOTAL PAGADO: ₡${total.toLocaleString()}*
Medio de Pago: ${paymentMethod}

¡Muchas gracias por su preferencia! Pura Vida. ✨`;

    const encoded = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
  };

  // Create another subaccount (e.g. Cuenta 3)
  const handleAddSubAccount = () => {
    const nextId = Math.max(...subAccounts.map(s => s.id), 0) + 1;
    const newSub: SubAccount = {
      id: nextId,
      name: `Cuenta ${nextId} (Comensal ${nextId})`
    };
    const updatedSubs = [...subAccounts, newSub];
    setSubAccounts(updatedSubs);

    if (onSaveTable && selectedTable) {
      onSaveTable({
        ...selectedTable,
        activeOrder: {
          ...(selectedTable.activeOrder || {}),
          orderNumber: selectedTable.activeOrder?.orderNumber || 'ORD-8921',
          server: effectiveServerName,
          openedAt: selectedTable.activeOrder?.openedAt || 'Ahora',
          subAccounts: updatedSubs,
          items: orderItems
        }
      });
    }
  };

  // Execute transfer from inside the invoice
  const handleConfirmTransfer = () => {
    if (!itemToTransfer) return;

    const targetSub = subAccounts.find(s => s.id === transferTargetSubId);
    if (!targetSub) return;

    let updatedList: TableItem[] = [];

    // Transfer partial qty or full
    const sourceItem = orderItems.find(i => i.id === itemToTransfer.id);
    if (!sourceItem) return;

    if (sourceItem.quantity <= transferQty) {
      // Move entirely
      updatedList = orderItems.map(it => 
        it.id === itemToTransfer.id ? { ...it, subAccountId: targetSub.id, dinerName: targetSub.name } : it
      );
    } else {
      // Split
      const remainingQty = sourceItem.quantity - transferQty;
      const newItem: TableItem = {
        ...sourceItem,
        id: `split_${Date.now()}`,
        quantity: transferQty,
        subAccountId: targetSub.id,
        dinerName: targetSub.name
      };

      updatedList = [
        ...orderItems.map(it => it.id === sourceItem.id ? { ...it, quantity: remainingQty } : it),
        newItem
      ];
    }

    setOrderItems(updatedList);
    setItemToTransfer(null);

    // Save back to table state
    if (onSaveTable && selectedTable) {
      onSaveTable({
        ...selectedTable,
        activeOrder: {
          ...(selectedTable.activeOrder || {}),
          orderNumber: selectedTable.activeOrder?.orderNumber || 'ORD-8921',
          server: effectiveServerName,
          openedAt: selectedTable.activeOrder?.openedAt || 'Ahora',
          subAccounts,
          items: updatedList
        }
      });
    }

    // Toast notification
    setTransferToast(`"${itemToTransfer.name}" trasladado a ${targetSub.name} con éxito ✓`);
    setTimeout(() => setTransferToast(null), 2500);
  };

  const invoiceObject: ElectronicInvoiceCR = {
    clave50Digitos,
    consecutivo,
    emisor: {
      nombre: tenant.name,
      cedulaJuridica: tenant.cedulaJuridica,
      nombreComercial: "Saborai POS Restaurant",
      correo: tenant.email,
      sucursal: branchCode,
      terminal: terminalCode
    },
    receptor: {
      nombre: activeDocType === 'FE' ? customerName : 'Cliente General Contado',
      tipoIdentificacion: '01-Fisica',
      identificacion: activeDocType === 'FE' ? customerCedula : '',
      correo: activeDocType === 'FE' ? customerEmail : ''
    },
    tipoDocumento: activeDocType,
    codigoActividadReceptor: activeDocType === 'FE' ? customerActivityCode : undefined,
    fechaEmision: claveInfo.fecha.toISOString(),
    condicionVenta: paymentMethod === '04-Credito' ? '04-Credito' : paymentMethod,
    medioPago: paymentMethod,
    pagos: paymentMethod === '04-Credito' ? [] : [{
      tipo: paymentMethod === '01-Efectivo' ? 'efectivo' : paymentMethod === '02-Tarjeta' ? 'tarjeta' : 'sinpe',
      monto: total
    }],
    moneda: 'CRC',
    tipoCambio: 1.0,
    items: activeItems,
    subtotal,
    iva13,
    iva4: 0,
    iva2: 0,
    iva1: 0,
    servicio10,
    totalComprobante: total,
    estadoHacienda: 'ACEPTADO'
  };

  const xmlContent = generateHaciendaXmlV44(invoiceObject, tenant);

  const handleCopyClave = () => {
    navigator.clipboard.writeText(clave50Digitos);
    setCopiedClave(true);
    setTimeout(() => setCopiedClave(false), 2000);
  };

  const handleDownloadXml = () => {
    downloadXmlFile(xmlContent, `FacturaElectronica_${clave50Digitos}.xml`);
  };

  const handleEmitToHacienda = () => {
    if (!currentShift) {
      if (onNotify) {
        onNotify({
          id: `err_shift_${Date.now()}`,
          type: 'HACIENDA_UPDATE',
          title: 'Turno no iniciado',
          message: 'Debe abrir un turno de caja antes de facturar.',
          timestamp: new Date()
        });
      }
      if (onOpenCashShift) onOpenCashShift('status');
      return;
    }

    if (isFacturaElectronica) {
      if (!customerName || !customerCedula || !customerEmail || !customerActivityCode) {
        if (onNotify) {
          onNotify({
            id: `err_form_${Date.now()}`,
            type: 'HACIENDA_UPDATE',
            title: 'Datos Incompletos',
            message: 'Debe llenar todos los datos para Factura Electrónica.',
            timestamp: new Date()
          });
        }
        return;
      }

      // Save customer for future
      try {
        let customers = getTenantItem<Array<{ cedula: string; name: string; email?: string; activityCode?: string }>>('customers', tenant.id) || [];
        const newCustomer = {
          cedula: customerCedula,
          name: customerName,
          email: customerEmail,
          activityCode: customerActivityCode
        };
        const existingIdx = customers.findIndex((c: any) => c.cedula.replace(/[-]/g, '') === customerCedula.replace(/[-]/g, ''));
        if (existingIdx >= 0) {
          customers[existingIdx] = newCustomer;
        } else {
          customers.push(newCustomer);
        }
        setTenantItem('customers', customers, tenant.id);
      } catch (err) {}
    }

    setIsInvoiceEmitted(true);

    // Record transaction into active cash shift of the current register
    let cashAmt = 0;
    let cardAmt = 0;
    let sinpeAmt = 0;

    if (paymentMethod === '01-Efectivo') {
      cashAmt = total;
    } else if (paymentMethod === '02-Tarjeta') {
      cardAmt = total;
    } else if (paymentMethod === '03-SINPE_Movil') {
      sinpeAmt = total;
    }

    if (paymentMethod !== '04-Credito') cashShiftService.recordSalePayment({
      cashAmount: cashAmt,
      cardAmount: cardAmt,
      sinpeAmount: sinpeAmt,
      subtotal,
      tax: iva13,
      service10: servicio10,
      registerId: currentRegister.id,
      tenantId: tenant.id,
      actor: currentUser || undefined,
      reference: clave50Digitos
    });

    // Deducción automática de insumos e ingredientes del inventario (escandallo)
    const itemsToDeduct = activeItems.map(it => ({ name: it.name, quantity: it.quantity }));
    const deductionResult = inventoryService.deductItemsStock(itemsToDeduct, 'SALE_DEDUCTION');
    if (deductionResult.depletedItems.length > 0 && onNotify) {
      onNotify({
        id: `depleted_${Date.now()}`,
        type: 'HACIENDA_UPDATE',
        title: '⚠️ Insumos agotados en cocina',
        message: `Los siguientes platillos quedaron agotados: ${deductionResult.depletedItems.join(', ')}`,
        timestamp: new Date()
      });
    }

    // Apertura automática del cajón de dinero (Cash drawer kick ESC p 0 25 250)
    if (paymentMethod === '01-Efectivo') {
      printerService.openCashDrawer().catch(() => {});
    }

    // Feedback auditivo de cobro completado
    soundService.playSuccessChime();

    // Reservar consecutivo real y construir el comprobante definitivo
    const emissionDate = new Date();
    const built = buildClaveYConsecutivo({
      cedula: effectiveCedula,
      branchCode,
      terminalCode,
      tipo: docType,
      numero: reserveConsecutivoNumber(branchCode, terminalCode, docType),
      fecha: emissionDate
    });
    setEmittedInfo({ clave: built.clave, consecutivo: built.consecutivo, fecha: emissionDate, tipo: docType });

    const finalInvoice: ElectronicInvoiceCR = {
      ...invoiceObject,
      emisor: {
        ...invoiceObject.emisor,
        cedulaJuridica: effectiveCedula
      },
      clave50Digitos: built.clave,
      consecutivo: built.consecutivo,
      tipoDocumento: docType,
      receptor: {
        nombre: docType === 'FE' ? customerName : 'Cliente General Contado',
        tipoIdentificacion: '01-Fisica',
        identificacion: docType === 'FE' ? customerCedula : '',
        correo: docType === 'FE' ? customerEmail : ''
      },
      codigoActividadReceptor: docType === 'FE' ? customerActivityCode : undefined,
      fechaEmision: emissionDate.toISOString(),
      estadoHacienda: 'PROCESANDO'
    };
    finalInvoice.xmlContent = generateHaciendaXmlV44(finalInvoice, tenant);

    haciendaService.emitInvoice(finalInvoice, (status, detail) => {
      let msg = detail || '';
      if (status === 'RECHAZADO' && detail && detail.includes('-408')) {
        msg = 'Error -408 en Hacienda: El Código de Actividad no coincide con su registro en ATV. Vaya a Ajustes → Hacienda y seleccione su actividad inscrita en ATV.';
      } else if (status === 'ACEPTADO') {
        msg = `Hacienda aceptó la factura ${built.clave.slice(-6)}`;
      }
      if (onNotify) {
        onNotify({
          id: `hacienda_${Date.now()}`,
          type: status === 'ACEPTADO' ? 'ORDER_READY' : status === 'RECHAZADO' ? 'NEW_ORDER' : 'HACIENDA_UPDATE',
          title: status === 'ACEPTADO' ? '✅ Factura Aceptada' : status === 'RECHAZADO' ? '❌ Factura Rechazada (DGT)' : '⏳ Procesando DGT...',
          message: msg || `Enviando XML a Hacienda...`,
          station: 'Bar',
          tableNumber: 0,
          server: 'Sistema',
          timestamp: new Date()
        });
      }
    });

    // 3. Liberar la mesa si se pagó la cuenta completa, o actualizar ítems si fue por subcuenta
    const isPayingAll = selectedSubAccount === 'ALL';
    const remainingItems = isPayingAll ? [] : orderItems.filter(i => (i.subAccountId || 1) !== selectedSubAccount);

    const effectiveTable: Table = selectedTable || {
      id: 'tbl_caja_rapida',
      number: 0,
      name: 'Venta Directa / Caja',
      zone: 'Caja',
      seats: 1,
      shape: 'square',
      status: 'AVAILABLE',
      x: 0,
      y: 0
    };

    let updatedTable: Table;
    if (isPayingAll || remainingItems.length === 0) {
      updatedTable = {
        ...effectiveTable,
        status: 'AVAILABLE',
        activeOrder: undefined
      };
      setOrderItems([]);
    } else {
      updatedTable = {
        ...effectiveTable,
        status: 'OCCUPIED',
        activeOrder: {
          ...(selectedTable?.activeOrder || {}),
          orderNumber: selectedTable?.activeOrder?.orderNumber || 'ORD-8921',
          server: effectiveServerName,
          openedAt: selectedTable?.activeOrder?.openedAt || 'Ahora',
          subAccounts,
          items: remainingItems
        }
      };
      setOrderItems(remainingItems);
    }

    if (onSaveTable && selectedTable) {
      onSaveTable(updatedTable);
    }

    const cloudTable: Table = {
      ...updatedTable,
      activeOrder: {
        ...(updatedTable.activeOrder || selectedTable?.activeOrder || {}),
        orderNumber: selectedTable?.activeOrder?.orderNumber || updatedTable.activeOrder?.orderNumber || `ORD-${Date.now()}`,
        server: effectiveServerName,
        openedAt: selectedTable?.activeOrder?.openedAt || updatedTable.activeOrder?.openedAt || new Date().toISOString(),
        subAccounts,
        items: updatedTable.activeOrder?.items || activeItems
      }
    };
    onRegisterPayment?.({
      table: cloudTable,
      invoice: finalInvoice,
      paymentMethod,
      total,
      closeOrder: isPayingAll || remainingItems.length === 0,
      items: activeItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        menuItemId: item.id
      }))
    });

    if (onEmitInvoice) {
      onEmitInvoice(finalInvoice);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {onBackToTables && (
              <button
                type="button"
                onClick={onBackToTables}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-all border border-stone-200/80 cursor-pointer shadow-2xs"
              >
                <ChevronLeft className="w-4 h-4 text-stone-600" />
                <span>Volver a Salones</span>
              </button>
            )}
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2 flex-wrap">
              <span>Caja & Facturación Electrónica</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                isSimplified
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-stone-100 text-stone-600 border border-stone-200'
              }`}>
                {isSimplified ? 'Régimen Simplificado CR (0% IVA • 10% Serv)' : 'Hacienda CR v4.4 (IVA 13%)'}
              </span>

              {/* Active Register Chip */}
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full border bg-white text-stone-800 border-stone-300 shadow-2xs flex items-center gap-1.5" title={`Terminal DGT: ${terminalCode} - ${currentRegister.name}`}>
                <span className={`w-2 h-2 rounded-full ${currentShift ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{currentRegister.name} ({terminalCode})</span>
              </span>
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            {isSimplified
              ? 'Comprobante de Régimen Simplificado con desglose del 10% de servicio de mesa (Ley N° 4946).'
              : 'División de cuentas entre comensales, traslado de ítems y emisión de tiquete fiscal v4.4.'}
          </p>

          {/* Warning if no shift open on this terminal */}
          {!currentShift && (
            <div className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-1.5 inline-flex items-center gap-2">
              <span>⚠️ Esta terminal ({currentRegister.name}) no tiene un turno de caja abierto.</span>
              {onOpenCashShift && (
                <button 
                  type="button" 
                  onClick={() => onOpenCashShift('status')} 
                  className="underline font-bold text-amber-950 hover:opacity-80 cursor-pointer"
                >
                  Abrir Turno Ahora
                </button>
              )}
            </div>
          )}
        </div>

        {/* Header Right Actions: Turno & Caja button + Paper Width Selector */}
        <div className="flex items-center gap-2">
          {onOpenHaciendaHistory && (
            <button
              type="button"
              onClick={onOpenHaciendaHistory}
              className="px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200/80 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Ver Historial de Facturas Emitidas a Hacienda"
            >
              <Building2 className="w-3.5 h-3.5 text-[#588157]" />
              <span className="hidden sm:inline">DGT</span>
            </button>
          )}

          {onOpenCashShift && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpenCashShift('status')}
                className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                title={`Ver movimientos de ${currentRegister.name} o estado de caja`}
              >
                <Receipt className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>{currentRegister.name}</span>
              </button>

              {currentShift && (
                <button
                  type="button"
                  onClick={() => onOpenCashShift('close')}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-xs cursor-pointer animate-in fade-in"
                  title="Cerrar turno de caja y realizar arqueo"
                >
                  <LockKeyhole className="w-3.5 h-3.5 text-stone-950" />
                  <span>Cerrar Turno</span>
                </button>
              )}
            </div>
          )}

          <div className="inline-flex p-1 rounded-2xl bg-stone-100 border border-stone-200/80 text-xs">
            <button
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1 rounded-xl font-bold transition-all ${
                paperWidth === '80mm' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
              }`}
            >
              80mm
            </button>
            <button
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1 rounded-xl font-bold transition-all ${
                paperWidth === '58mm' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
              }`}
            >
              58mm
            </button>
          </div>
        </div>
      </div>

      {/* Transfer Success Toast */}
      {transferToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top duration-200">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{transferToast}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Interactive Account Splitter, Items & Hacienda Customer Data (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* ================= SECTION 1: DIVISIÓN DE CUENTAS & TRASLADO DE ÍTEMS ================= */}
          <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <SplitSquareVertical className="w-4 h-4 text-[#588157]" />
                <h3 className="font-bold text-sm text-stone-900">
                  Separación de Cuentas & Traslado de Ítems
                </h3>
              </div>

              {/* Subaccount Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setSelectedSubAccount('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                    selectedSubAccount === 'ALL'
                      ? 'bg-stone-900 text-white shadow-xs'
                      : 'bg-stone-100 text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Cuenta Total ({orderItems.length})
                </button>

                {subAccounts.map((sub) => {
                  const count = orderItems.filter(i => (i.subAccountId || 1) === sub.id).length;
                  const isSelected = selectedSubAccount === sub.id;

                  return (
                    <button
                      key={sub.id}
                      onClick={() => setSelectedSubAccount(sub.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1 ${
                        isSelected
                          ? 'bg-stone-900 text-white shadow-xs'
                          : 'bg-stone-100 text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      <span>Cuenta {sub.id}</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        isSelected ? 'bg-[#588157] text-white' : 'bg-stone-200 text-stone-700'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={handleAddSubAccount}
                  className="px-2.5 py-1.5 rounded-xl border border-dashed border-stone-300 hover:border-stone-400 text-stone-600 text-xs font-bold flex items-center gap-1 transition-all shrink-0"
                  title="Añadir Cuenta 3 o más"
                >
                  <Plus className="w-3.5 h-3.5 text-[#588157]" />
                  <span>+ Subcuenta</span>
                </button>
              </div>
            </div>

            {/* List of items with direct Transfer actions */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-stone-400 uppercase block">
                {selectedSubAccount === 'ALL' 
                  ? 'Todos los ítems comandados en la mesa (Puedes trasladar cualquiera entre cuentas):' 
                  : `Ítems asignados a Cuenta ${selectedSubAccount}:`}
              </span>

              {activeItems.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-xs bg-stone-50 rounded-2xl">
                  Esta cuenta no tiene ítems asignados en este momento.
                </div>
              ) : (
                activeItems.map((item) => {
                  const currentSubId = item.subAccountId || 1;
                  // Other subaccounts available to transfer to
                  const otherSubs = subAccounts.filter(s => s.id !== currentSubId);

                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-stone-50 hover:bg-stone-100/80 rounded-2xl border border-stone-200/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-stone-900">{item.quantity}x</span>
                          <span className="font-bold text-stone-800 truncate">{item.name}</span>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-stone-200 text-[10px] font-semibold text-stone-600 shrink-0">
                            Asignado a: Cuenta {currentSubId}
                          </span>
                        </div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          Precio unitario: ₡{item.price.toLocaleString()} • Subtotal: ₡{(item.price * item.quantity).toLocaleString()}
                        </div>
                      </div>

                      {/* Traslado Rápido Button / Selector */}
                      <div className="flex items-center gap-2 shrink-0">
                        {otherSubs.length === 1 ? (
                          // Direct 1-click button if there are only 2 accounts (Cuenta 1 <-> Cuenta 2)
                          <button
                            onClick={() => {
                              setItemToTransfer(item);
                              setTransferTargetSubId(otherSubs[0].id);
                              setTransferQty(item.quantity);
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-stone-900 hover:text-white border border-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                            title={`Trasladar a Cuenta ${otherSubs[0].id}`}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[#588157]" />
                            <span>Mover a Cuenta {otherSubs[0].id}</span>
                          </button>
                        ) : (
                          // Dropdown / button if there are 3 or more accounts
                          <button
                            onClick={() => {
                              setItemToTransfer(item);
                              setTransferTargetSubId(otherSubs[0]?.id || 1);
                              setTransferQty(item.quantity);
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-stone-900 hover:text-white border border-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[#588157]" />
                            <span>Trasladar a...</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

          </div>

          {/* ================= SECTION 2: PAGO Y DATOS DEL RECEPTOR / CLIENTE ================= */}
          <div className="bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-100">
              <h3 className="font-bold text-sm text-stone-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#588157]" />
                <span>Medio de Pago y Datos del Cliente</span>
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-700">
                  {selectedSubAccount === 'ALL' ? 'Facturando Cuenta Total' : `Facturando Cuenta ${selectedSubAccount}`}
                </span>
                
                {/* Toggle Factura Electrónica */}
                {!isSimplified && (
                  <label className="flex items-center gap-2 cursor-pointer bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-xl hover:bg-stone-100 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={isFacturaElectronica}
                      onChange={(e) => setIsFacturaElectronica(e.target.checked)}
                      className="rounded border-stone-300 text-[#588157] focus:ring-[#588157]"
                    />
                    <span className="text-xs font-bold text-stone-800">
                      Solicitar Factura Electrónica (FE)
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* Medio de Pago y Propina de Ley (Siempre habilitados para Tiquete o Factura) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs font-semibold text-stone-700">
              <div>
                <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Medio de Pago</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => {
                    const method = e.target.value as '01-Efectivo' | '02-Tarjeta' | '03-SINPE_Movil' | '04-Credito';
                    setPaymentMethod(method);
                    if (method === '01-Efectivo' && !cashReceived) {
                      setCashReceived(total.toString());
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                >
                  <option value="02-Tarjeta">02 - Tarjeta Débito/Crédito</option>
                  <option value="01-Efectivo">01 - Efectivo</option>
                  <option value="03-SINPE_Movil">03 - SINPE Móvil Bancario</option>
                  {isExecutiveOrder && <option value="04-Credito">04 - Crédito a trabajador</option>}
                </select>
              </div>

              <div className="flex items-end pb-1">
                <label htmlFor="serv10" className="flex items-center gap-2.5 px-3.5 py-2.5 w-full rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100/70 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    id="serv10"
                    checked={includeService10}
                    onChange={(e) => setIncludeService10(e.target.checked)}
                    className="rounded border-stone-300 text-[#588157] focus:ring-[#588157]"
                  />
                  <span className="text-xs font-bold text-stone-800">
                    Incluir 10% Servicio de Mesa (Ley CR)
                  </span>
                </label>
              </div>
            </div>

            {/* Calculadora de Efectivo y Vuelto Rápido (Costa Rica CRC) */}
            {paymentMethod === '01-Efectivo' && (
              <div className="p-4 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                    <Banknote className="w-4 h-4 text-[#588157]" />
                    <span>Calculadora de Cambio / Vuelto</span>
                  </span>
                  <span className="text-[11px] font-bold text-emerald-800">
                    Total a Cobrar: <strong>₡{total.toLocaleString()}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-900 uppercase mb-1">
                      Monto Recibido del Cliente (₡)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={`Ej. ${total}`}
                      className="w-full px-3.5 py-2 rounded-xl border border-emerald-300 bg-white text-stone-900 font-black text-sm focus:outline-none focus:ring-2 focus:ring-[#588157]"
                    />
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-emerald-200 flex flex-col justify-center">
                    <span className="text-[10px] font-bold uppercase text-stone-400">
                      {Number(cashReceived || 0) >= total ? 'Vuelto / Cambio a Devolver' : 'Monto Faltante'}
                    </span>
                    <span className={`text-base font-black ${
                      Number(cashReceived || 0) >= total ? 'text-emerald-700' : 'text-amber-600'
                    }`}>
                      {Number(cashReceived || 0) >= total 
                        ? `₡${Math.max(0, Number(cashReceived || 0) - total).toLocaleString()}` 
                        : `- ₡${(total - Number(cashReceived || 0)).toLocaleString()}`
                      }
                    </span>
                  </div>
                </div>

                {/* Billetes rápidos de Costa Rica */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] font-bold text-emerald-900 uppercase mr-1">Billetes:</span>
                  <button
                    type="button"
                    onClick={() => setCashReceived(total.toString())}
                    className="px-2.5 py-1 bg-white hover:bg-emerald-100 border border-emerald-200 rounded-lg text-[11px] font-bold text-stone-800 transition-colors shadow-2xs"
                  >
                    Exacto
                  </button>
                  {[2000, 5000, 10000, 20000, 50000].map((bill) => (
                    <button
                      key={bill}
                      type="button"
                      onClick={() => setCashReceived(bill.toString())}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors shadow-2xs ${
                        Number(cashReceived) === bill
                          ? 'bg-[#588157] text-white border-[#588157]'
                          : 'bg-white hover:bg-emerald-100 border-emerald-200 text-stone-800'
                      }`}
                    >
                      ₡{bill.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Datos del Receptor (Revelación Progresiva: solo cuando se solicita Factura Electrónica o en Régimen Simplificado opcional) */}
            {(isFacturaElectronica || isSimplified) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-stone-100 text-xs font-semibold text-stone-700 animate-in fade-in duration-200">
                <div className="sm:col-span-2 md:col-span-1">
                  <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Cédula / Identificación</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customerCedula}
                      onChange={(e) => setCustomerCedula(e.target.value)}
                      placeholder="Ej. 101230456"
                      className="flex-1 px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                    />
                    <button
                      onClick={handleSearchHacienda}
                      disabled={isSearchingHacienda || !customerCedula}
                      className="px-4 py-2.5 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
                      title="Buscar en Padrón de Hacienda"
                    >
                      {isSearchingHacienda ? <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Search className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-2 md:col-span-1">
                  <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Nombre o Razón Social</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Extraído de Hacienda"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Correo Electrónico (XML & PDF)</label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="factura@cliente.cr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-stone-500 uppercase mb-1">Cod. Actividad Económica</label>
                  <input
                    type="text"
                    value={customerActivityCode}
                    onChange={(e) => setCustomerActivityCode(e.target.value)}
                    placeholder="Ej. 722003"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 text-stone-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  />
                </div>

                {/* Clientes Frecuentes Guardados Localmente (Modo Resiliente Offline) */}
                {savedCustomers.length > 0 && (
                  <div className="sm:col-span-2 pt-1 border-t border-stone-100 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-stone-400 mr-1">Clientes en Caché:</span>
                    {savedCustomers.slice(0, 4).map((c) => (
                      <button
                        key={c.cedula}
                        type="button"
                        onClick={() => {
                          setCustomerCedula(c.cedula);
                          setCustomerName(c.name);
                          if (c.email) setCustomerEmail(c.email);
                          if (c.activityCode) setCustomerActivityCode(c.activityCode);
                        }}
                        className="px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-[10px] font-bold text-stone-700 transition-colors border border-stone-200 cursor-pointer"
                        title={`Cargar datos de ${c.name} (${c.cedula})`}
                      >
                        {c.name.split(' ')[0]} ({c.cedula})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-3.5 py-2.5 rounded-xl bg-stone-50 border border-stone-200/70 text-[11px] text-stone-500 flex items-center justify-between">
                <span>Emitiendo <strong>Tiquete Electrónico (TE)</strong> rápido a Cliente Contado.</span>
                <button
                  type="button"
                  onClick={() => setIsFacturaElectronica(true)}
                  className="text-[#588157] font-bold hover:underline cursor-pointer"
                >
                  + Agregar receptor fiscal
                </button>
              </div>
            )}
          </div>

          {/* ================= SECTION 3: DETALLES TÉCNICOS HACIENDA CLAVE & XML (COLAPSABLE) ================= */}
          <details className="group bg-white border border-stone-200 rounded-3xl p-4 sm:px-6 shadow-xs">
            <summary className="list-none cursor-pointer flex items-center justify-between text-xs font-bold text-stone-700 hover:text-stone-950">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#588157]" />
                <span>
                  {isSimplified ? 'Detalles de Régimen Simplificado (DGT)' : `Detalles Técnicos Hacienda (Clave 50 dígitos y XML v4.4)`}
                </span>
              </span>
              <span className="text-[11px] text-stone-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>

            <div className="pt-4 mt-3 border-t border-stone-100 space-y-3">
              {!isSimplified && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-stone-500 uppercase">Clave Numérica Oficial</span>
                  <button
                    onClick={handleCopyClave}
                    className="text-xs font-bold text-stone-700 hover:text-stone-900 flex items-center gap-1"
                  >
                    {copiedClave ? <Check className="w-3.5 h-3.5 text-[#588157]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedClave ? 'Copiada' : 'Copiar Clave'}</span>
                  </button>
                </div>
              )}

              {isSimplified ? (
                <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-200 text-xs text-stone-700 space-y-1.5">
                  <div className="font-bold text-emerald-950 flex items-center gap-1">
                    <span>Autorizado por la Dirección General de Tributación (DGT)</span>
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    Las ventas no generan débito fiscal del 13% de IVA al consumidor (0% IVA). Se desglosa el 10% de ventas por servicio de mesa de conformidad con la Ley N° 4946.
                  </p>
                  <div className="text-[11px] font-mono text-stone-600 pt-1">
                    Comprobante N°: <strong>{consecutivo}</strong>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 font-mono text-xs text-stone-800 break-all select-all">
                  {clave50Digitos}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  onClick={() => setShowXmlModal(true)}
                  className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-stone-200"
                >
                  <Code className="w-3.5 h-3.5 text-[#588157]" />
                  <span>{isSimplified ? 'Ver Documento Fiscal' : 'Ver XML v4.4'}</span>
                </button>

                <button
                  onClick={handleDownloadXml}
                  className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-stone-200 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#588157]" />
                  <span>{isSimplified ? 'Descargar Comprobante' : 'Descargar .XML'}</span>
                </button>

                <button
                  onClick={handleShareWhatsApp}
                  className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-emerald-300 cursor-pointer"
                  title="Compartir comprobante por WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Enviar por WhatsApp</span>
                </button>
              </div>
            </div>
          </details>

          {/* Action Trigger */}
          <button
            onClick={handleEmitToHacienda}
            className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold text-sm hover:bg-stone-800 transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            {isInvoiceEmitted ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                <span>{isSimplified ? 'Comprobante Registrado con Éxito ✓' : isFacturaElectronica ? 'Factura Transmitida con Éxito a Hacienda CR ✓' : 'Tiquete Electrónico Emitido con Éxito ✓'}</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-[#a9b994]" />
                <span>
                  {isSimplified ? 'Emitir Comprobante Simplificado' : isFacturaElectronica ? 'Emitir Factura Electrónica' : 'Emitir Tiquete Electrónico'} de {selectedSubAccount === 'ALL' ? 'Cuenta Total' : `Cuenta ${selectedSubAccount}`} (₡{total.toLocaleString()})
                </span>
              </>
            )}
          </button>

          {/* Botón de Envío Directo por WhatsApp tras Cobro */}
          {isInvoiceEmitted && (
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm animate-in fade-in cursor-pointer"
            >
              <MessageCircle className="w-4 h-4 text-white" />
              <span>Compartir Comprobante Digital por WhatsApp 📱</span>
            </button>
          )}

          {isInvoiceEmitted && onBackToTables && (
            <button
              type="button"
              onClick={onBackToTables}
              className="w-full py-3.5 bg-stone-900 hover:bg-stone-800 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm animate-in fade-in cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
              <span>Mesa Liberada ✓ Volver a Salones</span>
            </button>
          )}

        </div>

        {/* Right Column: Thermal Receipt Preview (Monochrome 80mm/58mm) (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          
          <div className="text-xs font-bold text-stone-500 mb-2 flex items-center justify-between w-full max-w-[340px]">
            <span className="flex items-center gap-1">
              <Printer className="w-3.5 h-3.5 text-[#588157]" />
              <span>Vista Previa Impresión ({paperWidth})</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleShareWhatsApp}
                className="text-emerald-700 hover:text-emerald-900 text-xs font-bold flex items-center gap-1 cursor-pointer"
                title="Compartir texto por WhatsApp"
              >
                <MessageCircle className="w-3 h-3 text-emerald-600" />
                <span>WhatsApp</span>
              </button>
              <button
                onClick={() => window.print()}
                className="text-stone-700 hover:text-stone-900 text-xs font-bold underline cursor-pointer"
              >
                Imprimir
              </button>
            </div>
          </div>

          {/* Thermal Paper Container */}
          <div 
            className={`printable-invoice bg-white text-black font-mono text-[11px] leading-tight p-6 shadow-xl border border-stone-300 rounded-xl transition-all ${
              paperWidth === '80mm' ? 'w-full max-w-[340px]' : 'w-full max-w-[260px] text-[10px]'
            }`}
          >
            {/* Ticket Header */}
            <div className="text-center space-y-1 pb-3 border-b border-dashed border-black">
              <div className="font-black text-sm tracking-wider">SABORAI POS</div>
              <div className="font-bold uppercase text-[12px]">{tenant.name}</div>
              <div>Cédula: {tenant.cedulaJuridica}</div>
              <div>{tenant.location}</div>
              <div>Tel: {tenant.phone}</div>
            </div>

            {/* Invoice Meta */}
            <div className="py-2.5 border-b border-dashed border-black space-y-0.5 text-[10px]">
              <div className="font-bold text-center uppercase">
                {isSimplified
                  ? (selectedSubAccount === 'ALL' ? 'COMPROBANTE RÉGIMEN SIMPLIFICADO' : `COMPROBANTE RÉGIMEN SIMPLIFICADO - CUENTA ${selectedSubAccount}`)
                  : isFacturaElectronica
                    ? (selectedSubAccount === 'ALL' ? 'FACTURA ELECTRÓNICA v4.4' : `FACTURA ELECTRÓNICA - CUENTA ${selectedSubAccount}`)
                    : (selectedSubAccount === 'ALL' ? 'TIQUETE ELECTRÓNICO v4.4' : `TIQUETE ELECTRÓNICO - CUENTA ${selectedSubAccount}`)}
              </div>
              <div>Consecutivo: {consecutivo}</div>
              <div>Fecha: {new Date().toLocaleDateString('es-CR')} {new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div>Mesa: {selectedTable?.name || 'Venta Directa / Caja'}</div>
              <div>Cliente: {isFacturaElectronica ? customerName : 'Cliente Contado'}</div>
              {isFacturaElectronica && <div>Cédula: {customerCedula}</div>}
              {isFacturaElectronica && <div>Actividad: {customerActivityCode}</div>}
              <div>Pago: {paymentMethod}</div>
            </div>

            {/* Line Items */}
            <div className="py-3 border-b border-dashed border-black space-y-1.5">
              <div className="flex justify-between font-bold uppercase text-[9px]">
                <span>CANT / DESCRIPCION</span>
                <span>TOTAL</span>
              </div>
              {activeItems.map((item: TableItem, idx: number) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span>{item.quantity}x {item.name.substring(0, paperWidth === '80mm' ? 24 : 16)}</span>
                    <span>₡{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                  <div className="text-[8px] text-stone-600">
                    CABYS: {item.cabysCode} (Cuenta {item.subAccountId || 1})
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="py-2.5 border-b border-dashed border-black space-y-1 text-right">
              <div className="flex justify-between">
                <span>SUBTOTAL:</span>
                <span>₡{subtotal.toLocaleString()}</span>
              </div>
              {!isSimplified ? (
                <div className="flex justify-between">
                  <span>IVA (13%):</span>
                  <span>₡{iva13.toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex justify-between text-[9px] text-stone-600">
                  <span>IVA (0%):</span>
                  <span>EXENTO / RÉGIMEN SIMPLIFICADO</span>
                </div>
              )}
              {includeService10 && (
                <div className="flex justify-between font-bold">
                  <span>SERVICIO MESA LEY 4946 (10%):</span>
                  <span>₡{servicio10.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm pt-1 border-t border-dashed border-black">
                <span>TOTAL A PAGAR:</span>
                <span>₡{total.toLocaleString()}</span>
              </div>
            </div>

            {/* Footer: Hacienda Clave & QR or Simplified Regime Note */}
            {isSimplified ? (
              <div className="pt-3 text-center space-y-1 text-[9px]">
                <div className="font-bold uppercase tracking-wider">
                  RÉGIMEN DE TRIBUTACIÓN SIMPLIFICADA
                </div>
                <div className="text-[8px] text-stone-600 leading-tight">
                  Autorizado por la Dirección General de Tributación Costa Rica.
                  <br />
                  No genera crédito fiscal de IVA para el consumidor.
                </div>
                <div className="text-[8px] text-stone-700 font-semibold pt-1">
                  Ley N° 4946: 10% de Servicio incluido para personal de mesa.
                </div>
                <div className="text-[8px] font-mono pt-1 text-stone-500">
                  Control Interno #{consecutivo}
                </div>
              </div>
            ) : (
              <div className="pt-3 text-center space-y-2">
                <div className="text-[8px] break-all">
                  Clave Numérica:
                  <br />
                  {clave50Digitos}
                </div>

                <div className="w-20 h-20 mx-auto border border-black p-1 bg-white flex flex-col items-center justify-center">
                  <div className="w-full h-full bg-stone-900 flex items-center justify-center text-[7px] text-white font-bold p-1 text-center">
                    QR HACIENDA CR v4.4
                  </div>
                </div>

                <div className="text-[8px] text-stone-500">
                  Autorizada mediante resolución DGT-R-033-2019
                </div>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* ================= MODAL: TRASLADAR ÍTEM ENTRE CUENTAS ================= */}
      {itemToTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-4 animate-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-[#588157]" />
                <h3 className="text-sm font-bold text-stone-900">Trasladar Ítem a otra Cuenta</h3>
              </div>
              <button
                onClick={() => setItemToTransfer(null)}
                className="w-7 h-7 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center hover:bg-stone-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/80">
                <span className="font-bold text-stone-900 block">{itemToTransfer.name}</span>
                <span className="text-stone-500 text-[11px]">
                  Cuenta actual: <strong>Cuenta {itemToTransfer.subAccountId || 1}</strong> • Total disponibles: {itemToTransfer.quantity} und.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Mover hacia:</label>
                <select
                  value={transferTargetSubId}
                  onChange={(e) => setTransferTargetSubId(Number(e.target.value))}
                  className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-900 focus:outline-none"
                >
                  {subAccounts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.id === (itemToTransfer.subAccountId || 1) ? '(Actual)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {itemToTransfer.quantity > 1 && (
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Cantidad a mover (de {itemToTransfer.quantity} disponibles):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={itemToTransfer.quantity}
                    value={transferQty}
                    onChange={(e) => setTransferQty(Math.min(itemToTransfer.quantity, Math.max(1, Number(e.target.value))))}
                    className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-900 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setItemToTransfer(null)}
                className="px-3.5 py-2 rounded-xl border border-stone-200 text-stone-600 text-xs font-semibold hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmTransfer}
                className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-stone-800 shadow-xs flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>Confirmar Traslado</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* XML Modal */}
      {showXmlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-base font-bold text-stone-900">XML Factura Electrónica v4.4 (Hacienda CR)</h3>
              <button
                onClick={() => setShowXmlModal(false)}
                className="px-3 py-1 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-bold"
              >
                Cerrar
              </button>
            </div>

            <pre className="p-4 bg-stone-900 text-emerald-400 font-mono text-[11px] rounded-2xl max-h-[450px] overflow-y-auto whitespace-pre-wrap">
              {xmlContent}
            </pre>
          </div>
        </div>
      )}

    </div>
  );
};
