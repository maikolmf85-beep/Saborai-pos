import React, { useState, useRef, useEffect } from 'react';
import { Table, TableStatus, UserProfile } from '../types';
import { WaiterPinModal } from './WaiterPinModal';
import { 
  Plus, 
  UtensilsCrossed, 
  ReceiptText, 
  Clock, 
  User, 
  Trash2, 
  Check, 
  X,
  CreditCard,
  Pencil,
  Move,
  Lock,
  Unlock,
  ChevronRight,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRight
} from 'lucide-react';

interface TableMapProps {
  tables: Table[];
  onSelectTable: (table: Table) => void;
  onOpenOrder: (table: Table) => void;
  onSplitBill: (table: Table) => void;
  isAdmin?: boolean;
  staffList?: UserProfile[];
  tenant: import('../types').TenantInfo;
  onUpdateTenant: (tenant: import('../types').TenantInfo) => void;
  onUpdateTables?: (tables: Table[]) => void;
}

export const TableMap: React.FC<TableMapProps> = ({
  tables: initialTablesList,
  onSelectTable,
  onOpenOrder,
  onSplitBill,
  isAdmin = true,
  staffList = [],
  tenant,
  onUpdateTenant,
  onUpdateTables
}) => {
  const tenantZones = tenant.zones || [];
  
  // Load saved positions from localStorage if available, or fall back to initialTablesList
  const [tables, setTables] = useState<Table[]>(() => {
    try {
      const saved = localStorage.getItem(`saborai_table_positions_${tenant.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return initialTablesList.map(t => {
            const match = parsed.find((p: any) => p.id === t.id);
            return match ? { ...t, x: match.x, y: match.y, zone: match.zone || t.zone } : t;
          });
        }
      }
    } catch {
      // fallback
    }
    return initialTablesList;
  });

  const [selectedZone, setSelectedZone] = useState<string>('Todas');
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [selectedTable, setSelectedTable] = useState<Table | null>(tables[0] || null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showDetailsDrawer, setShowDetailsDrawer] = useState<boolean>(true);

  // Sync fullscreen state with browser changes
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Waiter PIN selection modal state
  const [tableForPinAuth, setTableForPinAuth] = useState<Table | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);

  // New Table Form state
  const [newTableName, setNewTableName] = useState('');
  const [newTableSeats, setNewTableSeats] = useState<number>(4);
  const [newTableShape, setNewTableShape] = useState<'round' | 'square' | 'bar'>('round');
  const [newTableZone, setNewTableZone] = useState<string>(tenantZones.length > 0 ? tenantZones[0] : '');

  // Zone management state
  const [isZoneModalOpen, setIsZoneModalOpen] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');

  // Dragging state (PointerEvents for mouse + touch support)
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Persist positions to localStorage
  useEffect(() => {
    try {
      const positions = tables.map(t => ({ id: t.id, x: t.x, y: t.y, zone: t.zone }));
      localStorage.setItem(`saborai_table_positions_${tenant.id}`, JSON.stringify(positions));
    } catch {
      // ignore storage error
    }
  }, [tables, tenant.id]);

  const filteredTables = selectedZone === 'Todas' 
    ? tables 
    : tables.filter(t => t.zone === selectedZone);

  const calculateTableTotal = (table: Table) => {
    if (!table.activeOrder) return 0;
    return table.activeOrder.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  };

  const occupiedCount = tables.filter(t => t.status === 'OCCUPIED' || t.status === 'PRE_CHECK').length;
  const availableCount = tables.filter(t => t.status === 'AVAILABLE').length;
  const totalSalesInProgress = tables.reduce((acc, t) => acc + calculateTableTotal(t), 0);

  // Pointer drag start
  const handlePointerDown = (e: React.PointerEvent, table: Table) => {
    if (!isEditMode) {
      setSelectedTable(table);
      onSelectTable(table);
      return;
    }

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingId(table.id);
    setSelectedTable(table);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const currentX = (table.x / 100) * rect.width;
      const currentY = (table.y / 100) * rect.height;
      setDragOffset({
        x: e.clientX - rect.left - currentX,
        y: e.clientY - rect.top - currentY
      });
    }
  };

  // Pointer move
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !canvasRef.current || !isEditMode) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left - dragOffset.x;
    const rawY = e.clientY - rect.top - dragOffset.y;

    // Constrain within canvas bounds (leaving 40px margin)
    const clampedX = Math.max(30, Math.min(rawX, rect.width - 70));
    const clampedY = Math.max(30, Math.min(rawY, rect.height - 70));

    // Convert to percentage for responsive positioning
    const percentX = Math.round(((clampedX) / rect.width) * 100);
    const percentY = Math.round(((clampedY) / rect.height) * 100);

    setTables(prev => prev.map(t => t.id === draggingId ? { ...t, x: percentX, y: percentY } : t));
  };

  // Pointer drag end
  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setDraggingId(null);
    }
  };

  const handleAddNewTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableName.trim()) return;

    const nextNumber = Math.max(...tables.map(t => t.number), 0) + 1;
    // Calculate an unoccupied position
    const posX = 15 + ((tables.length * 14) % 65);
    const posY = 20 + ((tables.length * 16) % 60);

    const newTbl: Table = {
      id: `tbl_${Date.now()}`,
      number: nextNumber,
      name: newTableName.trim(),
      seats: newTableSeats,
      shape: newTableShape,
      status: 'AVAILABLE',
      zone: newTableZone,
      x: posX,
      y: posY,
    };

    const updatedTables = [...tables, newTbl];
    setTables(updatedTables);
    if (onUpdateTables) onUpdateTables(updatedTables);

    setSelectedTable(newTbl);
    setShowAddModal(false);
    setNewTableName('');
  };

  const handleDeleteTable = (tableId: string) => {
    if (window.confirm('¿Seguro que deseas eliminar esta mesa del plano?')) {
      const updatedTables = tables.filter(t => t.id !== tableId);
      setTables(updatedTables);
      if (onUpdateTables) onUpdateTables(updatedTables);

      if (selectedTable?.id === tableId) {
        setSelectedTable(null);
      }
    }
  };

  const handleAddZone = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newZoneName.trim();
    if (!cleanName || tenantZones.includes(cleanName)) return;

    onUpdateTenant({
      ...tenant,
      zones: [...tenantZones, cleanName]
    });
    setNewZoneName('');
  };

  const handleDeleteZone = (zone: string) => {
    const hasTables = tables.some(t => t.zone === zone);
    if (hasTables) {
      alert(`No puedes eliminar el salón "${zone}" porque tiene mesas asignadas. Elimina o mueve las mesas primero.`);
      return;
    }

    if (window.confirm(`¿Seguro que deseas eliminar el salón "${zone}"?`)) {
      onUpdateTenant({
        ...tenant,
        zones: tenantZones.filter(z => z !== zone)
      });
      if (selectedZone === zone) setSelectedZone('Todas');
    }
  };

  const handleOpenTableOrder = (table: Table) => {
    if (table.status === 'AVAILABLE') {
      // Require server PIN selection before starting new order
      setTableForPinAuth(table);
      setIsPinModalOpen(true);
    } else {
      onOpenOrder(table);
    }
  };

  const handlePinValidated = (staff: UserProfile) => {
    if (!tableForPinAuth) return;

    const updated = tables.map(t => {
      if (t.id === tableForPinAuth.id) {
        return {
          ...t,
          status: 'OCCUPIED' as TableStatus,
          activeOrder: {
            orderNumber: t.activeOrder?.orderNumber || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
            server: staff.name,
            openedAt: t.activeOrder?.openedAt || new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
            subAccounts: t.activeOrder?.subAccounts || [{ id: 1, name: 'Comensal 1' }],
            items: t.activeOrder?.items || []
          }
        };
      }
      return t;
    });

    setTables(updated);
    if (onUpdateTables) onUpdateTables(updated);

    const updatedTbl = updated.find(t => t.id === tableForPinAuth.id) || tableForPinAuth;
    setSelectedTable(updatedTbl);
    onOpenOrder(updatedTbl);
    setTableForPinAuth(null);
  };

  // Helper to render chairs around circular table
  const renderChairs = (seats: number) => {
    const chairs = [];
    const count = Math.min(seats, 8);
    for (let i = 0; i < count; i++) {
      const angle = (i * (360 / count)) * (Math.PI / 180);
      const radius = 32; // distance from center in px
      const cx = 32 + radius * Math.cos(angle);
      const cy = 32 + radius * Math.sin(angle);

      chairs.push(
        <span
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full bg-stone-300 border border-stone-400 pointer-events-none transition-transform group-hover:scale-115"
          style={{
            left: `${cx - 5}px`,
            top: `${cy - 5}px`,
          }}
        />
      );
    }
    return chairs;
  };

  return (
    <div className="w-full h-full flex flex-col p-2.5 sm:p-3.5 gap-2.5 overflow-hidden animate-in fade-in duration-150 bg-[#fafaf9]">
      
      {/* Top Header & Compact Live Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-stone-200/80 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight flex items-center gap-2">
            <span>Plano del Salón</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
              {filteredTables.length} mesas
            </span>
          </h1>

          {/* Zone Filter Navigation Inline */}
          <div className="flex items-center gap-1 bg-stone-100/90 p-1 rounded-xl border border-stone-200/80 overflow-x-auto scrollbar-none">
            {['Todas', ...tenantZones].map((zone) => (
              <button
                key={zone}
                onClick={() => setSelectedZone(zone)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shrink-0 cursor-pointer ${
                  selectedZone === zone
                    ? 'bg-stone-900 text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/60'
                }`}
              >
                {zone === 'Todas' ? 'Todas' : zone}
              </button>
            ))}
            {isAdmin && (
              <button
                onClick={() => setIsZoneModalOpen(true)}
                className="px-2 py-1 ml-1 rounded-lg text-[11px] font-bold text-[#a9b994] bg-[#a9b994]/10 hover:bg-[#a9b994]/20 border border-[#a9b994]/30 flex items-center gap-1 cursor-pointer transition-colors"
                title="Gestionar Salones"
              >
                <Plus className="w-3 h-3" />
                <span>Salones</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Action Controls & Metrics & Fullscreen */}
        <div className="flex items-center gap-2">
          {/* Live Metrics */}
          <div className="hidden md:flex items-center gap-2 text-xs font-bold">
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{availableCount} Libres</span>
            </span>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-lg flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{occupiedCount} Ocupadas</span>
            </span>
            <span className="px-2.5 py-1 bg-stone-100 text-stone-800 border border-stone-200 rounded-lg flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5 text-[#588157]" />
              <span>₡{totalSalesInProgress.toLocaleString()}</span>
            </span>
          </div>

          {/* Toggle Drawer Button (Ocultar/Ver Info de Mesa para Pantalla Completa Pura) */}
          <button
            type="button"
            onClick={() => setShowDetailsDrawer(!showDetailsDrawer)}
            className={`h-8 px-2.5 flex items-center gap-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
              showDetailsDrawer 
                ? 'bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200' 
                : 'bg-[#a9b994]/25 text-stone-950 border-[#a9b994] font-black'
            }`}
            title={showDetailsDrawer ? "Ocultar panel lateral para maximizar plano a pantalla completa" : "Mostrar panel de detalles de mesa"}
          >
            {showDetailsDrawer ? <PanelRightClose className="w-3.5 h-3.5 text-stone-600" /> : <PanelRight className="w-3.5 h-3.5 text-stone-900" />}
            <span className="hidden lg:inline">{showDetailsDrawer ? "Ocultar Panel" : "Ver Panel"}</span>
          </button>

          {/* Botón de Pantalla Completa Inmersiva */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="h-8 px-2.5 sm:px-3 flex items-center gap-1.5 rounded-xl text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white transition-all shadow-xs border border-stone-800 cursor-pointer"
            title={isFullscreen ? "Salir del modo pantalla completa" : "Activar pantalla completa para terminales táctiles y monitores"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-amber-300" /> : <Maximize2 className="w-3.5 h-3.5 text-[#a9b994]" />}
            <span className="hidden sm:inline">{isFullscreen ? "Salir Completa" : "Pantalla Completa"}</span>
          </button>

          {/* Admin Editing & Add Buttons */}
          {isAdmin && (
            <>
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={`h-8 flex items-center gap-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isEditMode
                    ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-300 animate-pulse'
                    : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
                }`}
                title={isEditMode ? 'Guardar y salir del modo edición' : 'Editar plano y mover mesas'}
              >
                {isEditMode ? <Unlock className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5 text-[#588157]" />}
                <span className="hidden xl:inline">{isEditMode ? "Listo" : "Editar"}</span>
              </button>

              <button
                onClick={() => setShowAddModal(true)}
                className="h-8 flex items-center gap-1.5 px-3 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#a9b994]" />
                <span className="hidden xl:inline">+ Mesa</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Floor Plan & Table Details Workspace Container */}
      <div className="flex-1 w-full min-h-0 flex flex-col lg:flex-row gap-3 overflow-hidden">
        
        {/* Interactive Floor Plan Map (Takes 100% height and dynamic width) */}
        <div className="flex-1 h-full min-h-0 bg-white border border-stone-200/90 rounded-2xl p-3 shadow-xs relative overflow-hidden flex flex-col justify-between">
          
          {/* Edit Mode Notice Banner */}
          {isEditMode && (
            <div className="absolute top-3 left-4 right-4 z-20 px-3 py-2 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
                <span>
                  <strong>Modo Edición:</strong> Haz clic o toca cualquier mesita circular y arrástrala para reposicionarla libremente.
                </span>
              </div>
              <button
                onClick={() => setIsEditMode(false)}
                className="px-2.5 py-1 bg-amber-900 text-white rounded-lg text-[10px] font-bold hover:bg-black"
              >
                Terminar
              </button>
            </div>
          )}

          {/* Architectural Canvas */}
          <div
            ref={canvasRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`relative w-full flex-1 min-h-0 h-full rounded-xl select-none touch-none overflow-hidden transition-colors ${
              isEditMode ? 'cursor-move bg-amber-50/20' : 'cursor-default bg-stone-50/70'
            }`}
            style={{
              backgroundImage: `radial-gradient(#d6d3d1 1.2px, transparent 1.2px)`,
              backgroundSize: '22px 22px',
            }}
          >
            {/* Zone Watermark Tag */}
            <div className="absolute bottom-4 left-4 text-[11px] font-black uppercase tracking-widest text-stone-300 pointer-events-none">
              {selectedZone === 'Todas' ? 'Plano General del Restaurante' : `Zona: ${selectedZone}`}
            </div>

            {/* Render Circular Tables */}
            {filteredTables.map((table) => {
              const isSelected = selectedTable?.id === table.id;
              const isOccupied = table.status === 'OCCUPIED';
              const isPreCheck = table.status === 'PRE_CHECK';
              const isAvailable = table.status === 'AVAILABLE';
              const isReserved = table.status === 'RESERVED';
              const isDragging = draggingId === table.id;
              const total = calculateTableTotal(table);

              // Circular Table Colors
              const tableBgClass = isOccupied
                ? 'bg-amber-100 text-amber-900 border-amber-400 ring-2 ring-amber-300/50'
                : isPreCheck
                ? 'bg-blue-100 text-blue-900 border-blue-400 ring-2 ring-blue-300/50'
                : isReserved
                ? 'bg-purple-100 text-purple-900 border-purple-400'
                : 'bg-white text-stone-800 border-stone-300 hover:border-[#588157]';

              return (
                <div
                  key={table.id}
                  onPointerDown={(e) => handlePointerDown(e, table)}
                  style={{
                    left: `${table.x}%`,
                    top: `${table.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`group absolute z-10 select-none transition-transform ${
                    isDragging ? 'scale-110 z-30 cursor-grabbing' : isEditMode ? 'cursor-grab hover:scale-105' : 'cursor-pointer hover:scale-105'
                  }`}
                  title={`${table.name} (${table.seats} sillas)`}
                >
                  {/* Outer container: 64x64 px table circle with chairs around */}
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    
                    {/* Cute Chairs around the Table */}
                    {renderChairs(table.seats)}

                    {/* The Circular Table Button */}
                    <div
                      className={`w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center shadow-md transition-all ${tableBgClass} ${
                        isSelected ? 'ring-3 ring-stone-900 ring-offset-2' : ''
                      }`}
                    >
                      {/* Table Name */}
                      <span className="text-[9px] font-black leading-tight text-center px-1 overflow-hidden text-ellipsis line-clamp-2">
                        {table.name}
                      </span>

                      {/* Small Status Dot or Price */}
                      {isOccupied ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-0.5 animate-pulse" />
                      ) : isPreCheck ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-0.5" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-0.5" />
                      )}
                    </div>


                    {/* Order Price Tag if occupied */}
                    {isOccupied && total > 0 && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded-full shadow-xs pointer-events-none whitespace-nowrap">
                        ₡{(total / 1000).toFixed(0)}k
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Canvas Footer bar */}
          <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#588157]" />
              <span>Salón conectado en tiempo real</span>
            </span>
            <span className="text-[11px]">
              {isEditMode ? 'Arrastra mesas para guardar su lugar' : 'Haz clic en una mesa para ver opciones'}
            </span>
          </div>

        </div>

        {/* Selected Table Detail Drawer (Collapsible for 100% full-width floor plan) */}
        {showDetailsDrawer && (
          <div className="w-full lg:w-80 xl:w-96 bg-white border border-stone-200/90 rounded-2xl p-4 shadow-xs flex flex-col justify-between h-full overflow-y-auto shrink-0 animate-in slide-in-from-right-4 duration-200">
          
          {selectedTable ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between pb-3 border-b border-stone-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    {selectedTable.zone}
                  </span>
                  <h3 className="text-xl font-black text-stone-900 leading-tight">
                    {selectedTable.name}
                  </h3>
                </div>

                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  selectedTable.status === 'OCCUPIED'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : selectedTable.status === 'PRE_CHECK'
                    ? 'bg-blue-100 text-blue-900 border border-blue-300'
                    : selectedTable.status === 'RESERVED'
                    ? 'bg-purple-100 text-purple-900 border border-purple-300'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}>
                  {selectedTable.status === 'OCCUPIED' ? 'Ocupada' : selectedTable.status === 'PRE_CHECK' ? 'Pre-Cuenta' : selectedTable.status === 'RESERVED' ? 'Reservada' : 'Disponible'}
                </span>
              </div>

              {/* Table Specifications */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                  <span className="text-stone-400 block text-[10px] font-bold uppercase">Capacidad</span>
                  <span className="font-bold text-stone-800">{selectedTable.seats} comensales</span>
                </div>

                <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                  <span className="text-stone-400 block text-[10px] font-bold uppercase">Ubicación</span>
                  <span className="font-bold text-stone-800">X: {selectedTable.x}% • Y: {selectedTable.y}%</span>
                </div>
              </div>

              {/* Active Order Details */}
              {selectedTable.activeOrder ? (
                <div className="p-3.5 bg-stone-50 rounded-2xl border border-stone-200/80 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-stone-900 flex items-center gap-1">
                      <span>{selectedTable.activeOrder.orderNumber}</span>
                    </span>
                    <span className="text-stone-500 text-[11px] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{selectedTable.activeOrder.openedAt}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-stone-600">
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-stone-400" />
                      <span>Salonero: <strong>{selectedTable.activeOrder.server}</strong></span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTableForPinAuth(selectedTable);
                        setIsPinModalOpen(true);
                      }}
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline"
                      title="Cambiar salonero encargado con PIN"
                    >
                      Reasignar
                    </button>
                  </div>

                  {/* Items count & Subtotal */}
                  <div className="pt-2 border-t border-stone-200/60 flex items-baseline justify-between">
                    <span className="text-xs text-stone-500">
                      {selectedTable.activeOrder.items.reduce((s, it) => s + it.quantity, 0)} ítems comandados
                    </span>
                    <span className="text-base font-black text-stone-900">
                      ₡{calculateTableTotal(selectedTable).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-6 bg-stone-50 rounded-2xl border border-stone-100 text-center text-xs text-stone-400">
                  Mesa lista y desinfectada para recibir comensales.
                </div>
              )}

              {/* Edit Mode specific actions */}
              {isEditMode && (
                <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs space-y-2">
                  <span className="font-bold text-amber-900 block text-[11px] uppercase">Ajustes de Mesa</span>
                  <button
                    onClick={() => handleDeleteTable(selectedTable.id)}
                    className="w-full py-2 bg-white text-red-600 hover:bg-red-50 border border-red-200 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar esta mesa del mapa</span>
                  </button>
                </div>
              )}

            </div>
          ) : (
            <div className="py-20 text-center text-stone-400 space-y-2">
              <p className="text-sm font-semibold">Ninguna mesa seleccionada</p>
              <p className="text-xs">Toca cualquier mesa circular en el mapa para ver sus detalles.</p>
            </div>
          )}

          {/* Action Buttons for Selected Table */}
          {selectedTable && (
            <div className="pt-4 border-t border-stone-100 space-y-2">
              <button
                onClick={() => handleOpenTableOrder(selectedTable)}
                className="w-full py-3 bg-stone-900 text-white hover:bg-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <UtensilsCrossed className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>
                  {selectedTable.status === 'AVAILABLE' ? 'Abrir Mesa y Comandar' : 'Tomar / Ver Pedido'}
                </span>
              </button>

              {selectedTable.activeOrder && (
                <button
                  onClick={() => onSplitBill(selectedTable)}
                  className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-stone-200"
                >
                  <ReceiptText className="w-3.5 h-3.5 text-[#588157]" />
                  <span>Cobrar / Facturar Mesa</span>
                </button>
              )}
            </div>
          )}

          </div>
        )}

      </div>

      {/* Modal: Añadir Mesa al Mapa */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-base font-bold text-stone-900">Añadir Mesita al Salón</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddNewTable} className="space-y-4 text-xs font-semibold text-stone-700">
              <div>
                <label className="block mb-1">Nombre / Ubicación</label>
                <input
                  type="text"
                  placeholder="Ej. Mesa 7 - Balcón"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  autoFocus
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Zona</label>
                  <select
                    value={newTableZone}
                    onChange={(e) => setNewTableZone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none"
                    required
                  >
                    {tenantZones.length === 0 && <option value="">(Sin salones)</option>}
                    {tenantZones.map(zone => (
                      <option key={zone} value={zone}>{zone}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block mb-1">Número de Sillas</label>
                  <select
                    value={newTableSeats}
                    onChange={(e) => setNewTableSeats(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none"
                  >
                    <option value={2}>2 comensales</option>
                    <option value={4}>4 comensales</option>
                    <option value={6}>6 comensales</option>
                    <option value={8}>8 comensales</option>
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-stone-400">
                La nueva mesa aparecerá como un botón circular en el mapa y podrás moverla al lugar exacto que desees.
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-stone-900 text-white font-bold hover:bg-stone-800 shadow-xs"
                >
                  Crear y Ubicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Gestión de Salones */}
      {isZoneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-stone-200 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-base font-bold text-stone-900">Gestión de Salones / Zonas</h3>
              <button
                onClick={() => setIsZoneModalOpen(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <form onSubmit={handleAddZone} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block mb-1 text-xs font-semibold text-stone-700">Añadir Nuevo Salón</label>
                  <input
                    type="text"
                    placeholder="Ej. Patio Trasero"
                    value={newZoneName}
                    onChange={(e) => setNewZoneName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#588157]/40 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newZoneName.trim() || tenantZones.includes(newZoneName.trim())}
                  className="px-4 py-2.5 rounded-xl bg-stone-900 text-white font-bold hover:bg-stone-800 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Agregar
                </button>
              </form>

              <div className="pt-2">
                <label className="block mb-2 text-xs font-semibold text-stone-700">Salones Configurados ({tenantZones.length})</label>
                {tenantZones.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-stone-200 text-center text-stone-400 text-sm">
                    No has creado ningún salón todavía. Crea uno para empezar a añadir mesas.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                    {tenantZones.map(zone => {
                      const tableCount = tables.filter(t => t.zone === zone).length;
                      return (
                        <div key={zone} className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200">
                          <div>
                            <span className="font-bold text-sm text-stone-900">{zone}</span>
                            <span className="ml-2 text-xs text-stone-500">({tableCount} mesas)</span>
                          </div>
                          <button
                            onClick={() => handleDeleteZone(zone)}
                            className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Eliminar salón"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-stone-100">
              <button
                onClick={() => setIsZoneModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-stone-100 text-stone-700 font-bold hover:bg-stone-200 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Asignar Salonero con PIN */}
      <WaiterPinModal
        isOpen={isPinModalOpen}
        onClose={() => {
          setIsPinModalOpen(false);
          setTableForPinAuth(null);
        }}
        table={tableForPinAuth}
        staffList={staffList}
        onConfirm={handlePinValidated}
      />

    </div>
  );
};
