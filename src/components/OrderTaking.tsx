import React, { useState } from 'react';
import { MenuItem, Table, TableItem, SubAccount, TenantInfo, UserRole } from '../types';
import { 
  Sparkles, 
  Plus, 
  Minus, 
  Trash2, 
  Send, 
  Search, 
  ChevronLeft, 
  UserPlus, 
  Edit2, 
  Check, 
  User, 
  Wallet, 
  ArrowRightLeft, 
  ReceiptText 
} from 'lucide-react';
import { QuickPaymentModal } from './QuickPaymentModal';
import { soundService } from '../services/soundEffects';
import { PosNotification } from './NotificationToast';

interface OrderTakingProps {
  table: Table;
  tenant: TenantInfo;
  menuItems: MenuItem[];
  onSaveOrder: (updatedTable: Table) => void;
  onBackToTables: () => void;
  onDirectInvoice?: (table: Table) => void;
  onNotify?: (notif: PosNotification) => void;
  userRole?: UserRole;
  onOpenQuickSwitch?: () => void;
}

export const OrderTaking: React.FC<OrderTakingProps> = ({
  table,
  tenant,
  menuItems,
  onSaveOrder,
  onBackToTables,
  onDirectInvoice,
  onNotify,
  userRole,
  onOpenQuickSwitch
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Subaccounts / Named Diners state
  const initialSubAccounts: SubAccount[] = table.activeOrder?.subAccounts?.length
    ? table.activeOrder.subAccounts
    : [
        { id: 1, name: 'Comensal 1' },
        { id: 2, name: 'Comensal 2' }
      ];

  const [subAccounts, setSubAccounts] = useState<SubAccount[]>(initialSubAccounts);
  const [selectedSubAccount, setSelectedSubAccount] = useState<number>(initialSubAccounts[0].id);
  const [editingDinerId, setEditingDinerId] = useState<number | null>(null);
  const [editingDinerName, setEditingDinerName] = useState('');

  const [currentOrderItems, setCurrentOrderItems] = useState<TableItem[]>(
    table.activeOrder?.items || []
  );
  
  const [selectedItemForNotes, setSelectedItemForNotes] = useState<string | null>(null);
  const [itemNoteText, setItemNoteText] = useState('');

  // Transfer item state
  const [transferringItem, setTransferringItem] = useState<TableItem | null>(null);
  const [transferQty, setTransferQty] = useState<number>(1);
  const [targetDinerId, setTargetDinerId] = useState<number>(initialSubAccounts[1]?.id || initialSubAccounts[0].id);

  // Payment modal state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentTargetDiner, setPaymentTargetDiner] = useState<{ id: number | 'ALL'; name?: string }>({ id: 'ALL' });
  const [orderSentBanner, setOrderSentBanner] = useState(false);

  const categories = ['Todas', 'Entradas', 'Platos Fuertes', 'Bebidas', 'Cafetería', 'Postres'];

  const currentDiner = subAccounts.find(s => s.id === selectedSubAccount) || subAccounts[0];

  const filteredMenuItems = menuItems.filter(item => {
    const matchesCategory = activeCategory === 'Todas' || item.category === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleAddDiner = () => {
    const nextId = Math.max(...subAccounts.map(s => s.id), 0) + 1;
    const newDiner: SubAccount = {
      id: nextId,
      name: `Comensal ${nextId}`
    };
    const updated = [...subAccounts, newDiner];
    setSubAccounts(updated);
    setSelectedSubAccount(nextId);
  };

  const handleSaveDinerName = (id: number) => {
    if (!editingDinerName.trim()) {
      setEditingDinerId(null);
      return;
    }
    const updatedSubs = subAccounts.map(s => s.id === id ? { ...s, name: editingDinerName.trim() } : s);
    setSubAccounts(updatedSubs);

    const updatedItems = currentOrderItems.map(i => 
      i.subAccountId === id ? { ...i, dinerName: editingDinerName.trim() } : i
    );
    setCurrentOrderItems(updatedItems);
    setEditingDinerId(null);
    setEditingDinerName('');
  };

  const handleAddItem = (product: MenuItem) => {
    const existingIndex = currentOrderItems.findIndex(
      i => i.name === product.name && i.subAccountId === selectedSubAccount
    );

    if (existingIndex > -1) {
      const updated = [...currentOrderItems];
      updated[existingIndex].quantity += 1;
      setCurrentOrderItems(updated);
    } else {
      const newItem: TableItem = {
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: product.name,
        price: product.price,
        quantity: 1,
        subAccountId: selectedSubAccount,
        dinerName: currentDiner.name,
        cabysCode: product.cabysCode,
        taxRate: product.taxRate,
        category: product.station === 'Bar' ? 'Bar' : 'Cocina',
      };
      setCurrentOrderItems([...currentOrderItems, newItem]);
    }
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    const updated = currentOrderItems
      .map(item => {
        if (item.id === itemId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter((item): item is TableItem => item !== null);

    setCurrentOrderItems(updated);
  };

  const handleOpenNotes = (item: TableItem) => {
    setSelectedItemForNotes(item.id);
    setItemNoteText(item.notes || '');
  };

  const handleSaveNote = () => {
    if (!selectedItemForNotes) return;
    const updated = currentOrderItems.map(i => 
      i.id === selectedItemForNotes ? { ...i, notes: itemNoteText } : i
    );
    setCurrentOrderItems(updated);
    setSelectedItemForNotes(null);
    setItemNoteText('');
  };

  const handleExecuteTransfer = () => {
    if (!transferringItem) return;
    const targetDiner = subAccounts.find(s => s.id === targetDinerId);
    if (!targetDiner) return;

    if (transferQty >= transferringItem.quantity) {
      const updated = currentOrderItems.map(i => 
        i.id === transferringItem.id 
          ? { ...i, subAccountId: targetDiner.id, dinerName: targetDiner.name } 
          : i
      );
      setCurrentOrderItems(updated);
    } else {
      const remainingQty = transferringItem.quantity - transferQty;
      const updated = currentOrderItems.map(i => 
        i.id === transferringItem.id ? { ...i, quantity: remainingQty } : i
      );
      const splitItem: TableItem = {
        ...transferringItem,
        id: `item_${Date.now()}_split`,
        quantity: transferQty,
        subAccountId: targetDiner.id,
        dinerName: targetDiner.name
      };
      setCurrentOrderItems([...updated, splitItem]);
    }

    setTransferringItem(null);
  };

  const handleSaveAndNotifyKitchen = () => {
    const updatedTable: Table = {
      ...table,
      status: 'OCCUPIED',
      activeOrder: {
        orderNumber: table.activeOrder?.orderNumber || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        server: table.activeOrder?.server || 'Mesero General',
        openedAt: table.activeOrder?.openedAt || 'Ahora',
        subAccounts,
        items: currentOrderItems
      }
    };
    onSaveOrder(updatedTable);

    // Play chime sound for kitchen & bar arrival
    const hasBar = currentOrderItems.some(i => i.category === 'Bar');
    const hasKitchen = currentOrderItems.some(i => i.category === 'Cocina' || !i.category);
    const station = hasBar && !hasKitchen ? 'Bar' : 'Cocina';
    soundService.playNewOrderSound(station);

    if (onNotify) {
      onNotify({
        id: `notif_${Date.now()}_${Math.random()}`,
        type: 'NEW_ORDER',
        title: `Nueva Comanda enviada a ${station}`,
        message: `${table.name}: ${currentOrderItems.length} producto(s) enviados.`,
        station,
        tableNumber: table.number,
        server: updatedTable.activeOrder?.server,
        timestamp: new Date()
      });
    }

    setOrderSentBanner(true);
    setTimeout(() => setOrderSentBanner(false), 2000);
  };

  const handleOpenPayment = (subAccountId: number | 'ALL', dinerName?: string) => {
    setPaymentTargetDiner({ id: subAccountId, name: dinerName });
    setPaymentModalOpen(true);
  };

  const handlePaymentComplete = (_method: string, _amount: number) => {
    if (paymentTargetDiner.id === 'ALL') {
      const updatedTable: Table = {
        ...table,
        status: 'AVAILABLE',
        activeOrder: undefined
      };
      onSaveOrder(updatedTable);
      onBackToTables();
    } else {
      const remainingItems = currentOrderItems.filter(i => i.subAccountId !== paymentTargetDiner.id);
      const updatedTable: Table = {
        ...table,
        activeOrder: {
          ...table.activeOrder!,
          items: remainingItems
        }
      };
      setCurrentOrderItems(remainingItems);
      onSaveOrder(updatedTable);
    }
  };

  // Calculations
  const isSimplified = tenant.taxRegime === 'SIMPLIFIED';
  const subtotal = currentOrderItems.reduce((acc, it) => acc + (it.price * it.quantity), 0);
  const iva13 = isSimplified ? 0 : subtotal * 0.13;
  const servicio10 = subtotal * 0.10; // Ley N° 4946 de Costa Rica: 10% obligatorio por servicio en salón/mesa
  const totalWithTaxes = subtotal + iva13 + servicio10;

  // AI Pairing Suggestion
  const lastOrdered = currentOrderItems[currentOrderItems.length - 1];
  const aiSuggestion = lastOrdered 
    ? menuItems.find(m => m.name === lastOrdered.name)?.aiSuggestedPairing 
    : 'Maridaje sugerido: Café Geisha o Copa de Tinto Malbec.';

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-5 animate-in fade-in duration-150">
      
      {/* Top Breadcrumb & Table Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToTables}
            className="flex items-center gap-1.5 px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-all border border-stone-200"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Volver a Mesas</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-stone-900">{table.name}</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
                {table.activeOrder?.orderNumber || 'Nueva Comanda'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-stone-500">
                {table.zone} • {table.seats} sillas
              </span>
              <span className="text-stone-300">•</span>
              {onOpenQuickSwitch ? (
                <button
                  type="button"
                  onClick={onOpenQuickSwitch}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-stone-800 bg-stone-100 hover:bg-[#588157]/15 hover:border-[#588157]/40 px-2 py-0.5 rounded-md border border-stone-200 transition-colors group cursor-pointer"
                  title="Cambiar salonero encargado con PIN"
                >
                  <User className="w-3 h-3 text-[#588157]" />
                  <span>Salonero: {table.activeOrder?.server || 'Mesero General'}</span>
                  <ArrowRightLeft className="w-2.5 h-2.5 text-stone-400 group-hover:text-stone-700" />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-stone-800 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200">
                  <User className="w-3 h-3 text-[#588157]" />
                  <span>Salonero: {table.activeOrder?.server || 'Mesero General'}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Diners Selector (Subcuentas) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[11px] font-bold text-stone-400 uppercase mr-1">Comensal:</span>
          {subAccounts.map((diner) => {
            const isSelected = selectedSubAccount === diner.id;
            const count = currentOrderItems.filter(i => i.subAccountId === diner.id).reduce((s, it) => s + it.quantity, 0);

            return (
              <div key={diner.id} className="flex items-center">
                {editingDinerId === diner.id ? (
                  <div className="flex items-center gap-1 bg-white border border-stone-300 rounded-xl px-2 py-1">
                    <input
                      type="text"
                      value={editingDinerName}
                      onChange={(e) => setEditingDinerName(e.target.value)}
                      className="text-xs font-bold text-stone-900 w-24 focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveDinerName(diner.id)}
                      className="text-[#588157] hover:text-emerald-700 p-0.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectedSubAccount(diner.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-stone-900 text-white shadow-xs'
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <User className={`w-3 h-3 ${isSelected ? 'text-[#a9b994]' : 'text-stone-400'}`} />
                    <span>{diner.name}</span>
                    {count > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        isSelected ? 'bg-[#588157] text-white' : 'bg-stone-200 text-stone-700'
                      }`}>
                        {count}
                      </span>
                    )}
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDinerId(diner.id);
                        setEditingDinerName(diner.name);
                      }}
                      className="text-stone-400 hover:text-stone-200 pl-1"
                      title="Editar nombre"
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                    </span>
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={handleAddDiner}
            className="px-2.5 py-1.5 bg-white border border-dashed border-stone-300 hover:border-stone-400 text-stone-600 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
            title="Añadir comensal para separar la cuenta"
          >
            <UserPlus className="w-3 h-3 text-[#588157]" />
            <span>+ Comensal</span>
          </button>
        </div>
      </div>

      {/* Confirmation notification banner */}
      {orderSentBanner && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center justify-between animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Comanda actualizada y enviada con éxito a Cocina & Bar (KDS).</span>
          </div>
        </div>
      )}

      {/* Main 2-Column POS Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Menu Catalog (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* Active Diner Notification Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-stone-100 rounded-2xl border border-stone-200/80 text-xs">
            <span className="text-stone-600">
              Agregando ítems a: <strong className="text-stone-900">{currentDiner.name}</strong>
            </span>
            <span className="text-[11px] text-stone-400 font-medium">
              Toca un producto para sumar
            </span>
          </div>

          {/* Search Bar & Category Navigation */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder="Buscar platillo, café o bebida..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-2xl text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#588157]/40 placeholder:text-stone-400"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    activeCategory === cat
                      ? 'bg-stone-900 text-white shadow-xs'
                      : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Copilot AI Pairing Pill */}
          {aiSuggestion && (
            <div className="px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-stone-700">
                <Sparkles className="w-3.5 h-3.5 text-[#588157]" />
                <span className="font-semibold text-stone-900">Saborai Copilot:</span>
                <span className="text-stone-600 truncate">{aiSuggestion}</span>
              </div>
            </div>
          )}

          {/* Clean Menu Items Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {filteredMenuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleAddItem(item)}
                className="group p-4 bg-white border border-stone-200 hover:border-[#588157] rounded-2xl text-left transition-all duration-150 flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xl p-1.5 rounded-xl bg-stone-50 border border-stone-100 group-hover:scale-110 transition-transform">
                      {item.imageIcon}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">
                      {item.station}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-stone-900 mt-2 line-clamp-1 group-hover:text-[#588157]">
                    {item.name}
                  </h4>
                  <p className="text-[11px] text-stone-500 line-clamp-2 mt-0.5">
                    {item.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 mt-2 border-t border-stone-100">
                  <span className="text-sm font-black text-stone-900">
                    ₡{item.price.toLocaleString()}
                  </span>
                  <span className="w-7 h-7 rounded-xl bg-stone-100 group-hover:bg-[#588157] group-hover:text-white text-stone-600 flex items-center justify-center transition-colors">
                    <Plus className="w-4 h-4" />
                  </span>
                </div>
              </button>
            ))}
          </div>

        </div>

        {/* Right Column: Live Order Ticket & Totals (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-stone-200 rounded-3xl p-5 shadow-sm flex flex-col justify-between min-h-[580px]">
          
          <div>
            {/* Ticket Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <div>
                <h3 className="text-base font-bold text-stone-900">Comanda en Vivo</h3>
                <p className="text-xs text-stone-400">
                  {currentOrderItems.length} ítems en orden
                </p>
              </div>

              <div className="flex items-center gap-1">
                {currentOrderItems.length > 0 && (
                  <button
                    onClick={() => setCurrentOrderItems([])}
                    className="p-1.5 rounded-xl text-stone-400 hover:text-red-600 hover:bg-red-50 text-xs flex items-center gap-1 font-medium transition-colors"
                    title="Vaciar comanda"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Limpiar</span>
                  </button>
                )}
              </div>
            </div>

            {/* Order Items List */}
            <div className="divide-y divide-stone-100 max-h-[380px] overflow-y-auto pr-1 mt-2">
              {currentOrderItems.length === 0 ? (
                <div className="py-16 text-center text-stone-400 space-y-2">
                  <p className="text-sm font-semibold">No hay platillos en la comanda</p>
                  <p className="text-xs">Toca cualquier platillo del menú para agregarlo.</p>
                </div>
              ) : (
                currentOrderItems.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-start justify-between gap-2 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-stone-900 truncate">{item.name}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-md bg-stone-100 text-stone-600 shrink-0">
                          {item.dinerName || 'Mesa'}
                        </span>
                      </div>

                      {item.notes && (
                        <p className="text-[11px] text-amber-700 font-medium italic mt-0.5">
                          Nota: {item.notes}
                        </p>
                      )}

                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-stone-400">
                          ₡{item.price.toLocaleString()} c/u
                        </span>
                        <button
                          onClick={() => handleOpenNotes(item)}
                          className="text-[10px] text-stone-400 hover:text-stone-700 underline"
                        >
                          {item.notes ? 'Editar nota' : '+ Nota'}
                        </button>
                        <button
                          onClick={() => {
                            setTransferringItem(item);
                            setTransferQty(1);
                          }}
                          className="text-[10px] text-stone-400 hover:text-stone-700 underline flex items-center gap-0.5"
                        >
                          <ArrowRightLeft className="w-2.5 h-2.5" />
                          <span>Mover</span>
                        </button>
                      </div>
                    </div>

                    {/* Quantity Selector & Item Total */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-xs font-black text-stone-900">
                        ₡{(item.price * item.quantity).toLocaleString()}
                      </span>

                      <div className="flex items-center gap-1 bg-stone-100 rounded-xl p-0.5 border border-stone-200/80">
                        <button
                          onClick={() => handleUpdateQuantity(item.id, -1)}
                          className="w-6 h-6 rounded-lg bg-white text-stone-700 hover:bg-stone-200 flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-bold text-stone-900">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => handleUpdateQuantity(item.id, 1)}
                          className="w-6 h-6 rounded-lg bg-white text-stone-700 hover:bg-stone-200 flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Ticket Financial Totals & Primary Actions */}
          <div className="pt-4 border-t border-stone-200 space-y-3">
            <div className="space-y-1.5 text-xs text-stone-500">
              {/* Regime Indicator Badge */}
              <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-stone-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Régimen Fiscal</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isSimplified 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                    : 'bg-stone-100 text-stone-700 border border-stone-200'
                }`}>
                  {isSimplified ? 'Simplificado (Sin IVA)' : 'Tradicional (IVA 13%)'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span>Subtotal Neto</span>
                <span className="font-semibold text-stone-800">₡{subtotal.toLocaleString()}</span>
              </div>
              {!isSimplified ? (
                <div className="flex items-center justify-between">
                  <span>IVA 13% (Hacienda CR)</span>
                  <span className="font-semibold text-stone-800">₡{Math.round(iva13).toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between text-emerald-800">
                  <span className="text-[11px]">IVA 0% (Régimen Simplificado CR)</span>
                  <span className="font-semibold text-xs">₡0</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <span>Servicio 10% de Mesa</span>
                  <span className="text-[10px] font-semibold text-stone-400">(Ley 4946)</span>
                </span>
                <span className="font-semibold text-stone-800">₡{Math.round(servicio10).toLocaleString()}</span>
              </div>

              <div className="flex items-baseline justify-between pt-2 border-t border-stone-200">
                <span className="text-sm font-black text-stone-900">Total a Cobrar</span>
                <span className="text-xl font-black text-stone-900">
                  ₡{Math.round(totalWithTaxes).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleSaveAndNotifyKitchen}
                disabled={currentOrderItems.length === 0}
                className="w-full py-3 bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Send className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>Enviar a Cocina</span>
              </button>

              <button
                onClick={() => handleOpenPayment('ALL')}
                disabled={currentOrderItems.length === 0}
                className={`w-full py-3 text-white disabled:opacity-40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs ${
                  userRole === 'SALONERO_CAJA'
                    ? 'bg-purple-700 hover:bg-purple-800 ring-2 ring-purple-400/40'
                    : 'bg-[#588157] hover:bg-[#476c46]'
                }`}
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>
                  {userRole === 'SALONERO_CAJA' 
                    ? 'Cobro en Mesa (Caja)' 
                    : userRole === 'SALONERO'
                    ? 'Avisar Cobro a Caja'
                    : 'Cobrar Mesa'}
                </span>
              </button>
            </div>

            {/* Direct Link to Hacienda Invoice or Simplified Voucher */}
            {onDirectInvoice && currentOrderItems.length > 0 && (
              <button
                onClick={() => onDirectInvoice(table)}
                className="w-full py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border border-stone-200"
              >
                <ReceiptText className="w-3.5 h-3.5 text-[#588157]" />
                <span>
                  {isSimplified
                    ? 'Comprobante Régimen Simplificado (Caja & Desglose 10%)'
                    : 'Factura Electrónica Hacienda v4.3 (XML / QR)'}
                </span>
              </button>
            )}
          </div>

        </div>

      </div>

      {/* Note Modal */}
      {selectedItemForNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-stone-200 space-y-4">
            <h3 className="text-sm font-bold text-stone-900">Agregar Nota para Cocina / Bar</h3>
            <textarea
              placeholder="Ej. Término 3/4, sin cebolla, aderezo aparte..."
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none"
              rows={3}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setSelectedItemForNotes(null)}
                className="px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNote}
                className="px-4 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-stone-800"
              >
                Guardar Nota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Item Modal */}
      {transferringItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl p-5 shadow-2xl border border-stone-200 space-y-4">
            <h3 className="text-sm font-bold text-stone-900">Mover ítem a otro comensal</h3>
            <p className="text-xs text-stone-500">{transferringItem.name}</p>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Comensal destino</label>
              <select
                value={targetDinerId}
                onChange={(e) => setTargetDinerId(Number(e.target.value))}
                className="w-full p-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none"
              >
                {subAccounts.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setTransferringItem(null)}
                className="px-3 py-1.5 rounded-xl border border-stone-200 text-stone-600 text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteTransfer}
                className="px-4 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-stone-800"
              >
                Confirmar Traslado
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Payment Modal */}
      <QuickPaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        table={table}
        tenant={tenant}
        subAccountId={paymentTargetDiner.id}
        dinerName={paymentTargetDiner.name}
        onPaymentComplete={handlePaymentComplete}
      />

    </div>
  );
};
