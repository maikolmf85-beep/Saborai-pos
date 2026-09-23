import React, { useState, useEffect } from 'react';
import { 
  Clock, 
  CheckCircle, 
  ChefHat, 
  Wine, 
  Flame, 
  CheckCheck,
  Bell,
  Volume2,
  List,
  LayoutGrid
} from 'lucide-react';
import { KDSOrder, MenuItem } from '../types';
import { soundService } from '../services/soundEffects';
import { PosNotification } from './NotificationToast';

interface KDSViewProps {
  orders: KDSOrder[];
  onUpdateStatus: (orderId: string, nextStatus: KDSOrder['status']) => void;
  onToggleItemCompletion: (orderId: string, itemId: string) => void;
  onNotify?: (notif: PosNotification) => void;
  menuItems?: MenuItem[];
}

export const KDSView: React.FC<KDSViewProps> = ({ orders, onUpdateStatus, onToggleItemCompletion, onNotify, menuItems = [] }) => {
  const [stationFilter, setStationFilter] = useState<'ALL' | 'Cocina' | 'Bar'>('ALL');
  const [viewMode, setViewMode] = useState<'TICKETS' | 'CONSOLIDATED'>('TICKETS');
  const [loadMultiplier, setLoadMultiplier] = useState<number>(1);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000); // 10s for better responsiveness
    return () => clearInterval(interval);
  }, []);
  
  const handleUpdateStatus = (orderId: string, nextStatus: KDSOrder['status']) => {
    const targetOrder = orders.find(o => o.id === orderId);

    // If marked as READY, sound the service bell & notify waiters!
    if (nextStatus === 'READY' && targetOrder) {
      soundService.playOrderReadySound();

      if (onNotify) {
        onNotify({
          id: `ready_${Date.now()}`,
          type: 'ORDER_READY',
          title: `🛎️ ¡${targetOrder.station === 'Bar' ? 'Bebida Lista' : 'Platillo Listo'} para Servir!`,
          message: `${targetOrder.tableName} tiene su comanda lista en ${targetOrder.station}.`,
          station: targetOrder.station,
          tableNumber: targetOrder.tableNumber,
          server: targetOrder.server,
          timestamp: new Date()
        });
      }
    }

    onUpdateStatus(orderId, nextStatus);
  };

  const handleToggleItemCompletion = (orderId: string, itemId: string) => {
    onToggleItemCompletion(orderId, itemId);
    
    // Check if it should play sound (this is an approximation since we don't have the updated state synchronously)
    const order = orders.find(o => o.id === orderId);
    if (order) {
      const updatedItems = order.items.map(it => it.id === itemId ? { ...it, completed: !it.completed } : it);
      const allCompleted = updatedItems.length > 0 && updatedItems.every(it => it.completed);
      if (allCompleted && order.status !== 'READY' && order.status !== 'SERVED') {
        soundService.playOrderReadySound();
        if (onNotify) {
          onNotify({
            id: `ready_auto_${Date.now()}`,
            type: 'ORDER_READY',
            title: `🛎️ ¡${order.station === 'Bar' ? 'Bebidas Listas' : 'Comanda Lista'}!`,
            message: `${order.tableName} tiene su comanda lista en ${order.station}.`,
            station: order.station,
            tableNumber: order.tableNumber,
            server: order.server,
            timestamp: new Date()
          });
        }
      }
    }
  };

  const activeOrders = orders.filter(o => o.status !== 'SERVED');

  const filteredOrders = stationFilter === 'ALL'
    ? activeOrders
    : activeOrders.filter(o => o.station === stationFilter);

  const getElapsedTimeInMinutes = (date: Date) => {
    return Math.floor((now - date.getTime()) / 60000);
  };

  const consolidatedItems = Object.values(
    filteredOrders
      .filter(o => o.status === 'PENDING' || o.status === 'IN_PREPARATION')
      .flatMap(o => o.items.map(it => ({ ...it, station: o.station })))
      .reduce((acc, it) => {
        const key = `${it.name}-${it.station}`;
        if (!acc[key]) acc[key] = { name: it.name, station: it.station, total: 0, completed: 0 };
        acc[key].total += it.quantity;
        if (it.completed) acc[key].completed += it.quantity;
        return acc;
      }, {} as Record<string, { name: string, station: string, total: number, completed: number }>)
  ).sort((a, b) => b.total - a.total);

  const pendingCount = orders.filter(o => o.status === 'PENDING').length;
  const inPrepCount = orders.filter(o => o.status === 'IN_PREPARATION').length;
  const readyCount = orders.filter(o => o.status === 'READY').length;

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6 animate-in fade-in duration-150">
      
      {/* Top KDS Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-200">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <span>Cocina & Bar (KDS)</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">
              {filteredOrders.length} comandas
            </span>
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Pantalla con alertas sonoras automáticas al entrar comandas y al marcar platos listos para saloneros.
          </p>
        </div>

        {/* Action Controls & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-2xl border border-stone-200/80 mr-2">
            <button
              onClick={() => setViewMode('TICKETS')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'TICKETS' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Por Comanda</span>
            </button>
            <button
              onClick={() => setViewMode('CONSOLIDATED')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'CONSOLIDATED' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Consolidado</span>
            </button>
          </div>

          {/* Traffic Load Selector */}
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-2xl border border-stone-200/80 mr-2">
            <button
              onClick={() => setLoadMultiplier(1)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                loadMultiplier === 1 ? 'bg-white text-emerald-700 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Normal (1x)
            </button>
            <button
              onClick={() => setLoadMultiplier(1.5)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                loadMultiplier === 1.5 ? 'bg-white text-amber-600 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Alto (1.5x)
            </button>
            <button
              onClick={() => setLoadMultiplier(2)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                loadMultiplier === 2 ? 'bg-white text-red-600 shadow-xs' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Saturado (2x)
            </button>
          </div>

          {/* Station Filter Buttons */}
          <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-2xl border border-stone-200/80">
            <button
              onClick={() => setStationFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                stationFilter === 'ALL'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Todas ({orders.length})
            </button>

            <button
              onClick={() => setStationFilter('Cocina')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                stationFilter === 'Cocina'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <ChefHat className={`w-3.5 h-3.5 ${stationFilter === 'Cocina' ? 'text-[#588157]' : 'text-stone-400'}`} />
              <span>Cocina ({orders.filter(o => o.station === 'Cocina').length})</span>
            </button>

            <button
              onClick={() => setStationFilter('Bar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                stationFilter === 'Bar'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Wine className={`w-3.5 h-3.5 ${stationFilter === 'Bar' ? 'text-[#588157]' : 'text-stone-400'}`} />
              <span>Bar ({orders.filter(o => o.station === 'Bar').length})</span>
            </button>
          </div>

        </div>
      </div>

      {/* Mini Progress Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-white rounded-2xl border border-stone-200 flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">Pendientes</span>
          <span className="text-base font-bold text-stone-800">{pendingCount}</span>
        </div>
        <div className="p-3 bg-white rounded-2xl border border-stone-200 flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">En Preparación</span>
          <span className="text-base font-bold text-amber-600">{inPrepCount}</span>
        </div>
        <div className="p-3 bg-white rounded-2xl border border-stone-200 flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">Listas para Servir</span>
          <span className="text-base font-bold text-emerald-600">{readyCount}</span>
        </div>
      </div>

      {/* Orders Grid or Consolidated View */}
      {viewMode === 'CONSOLIDATED' ? (
        <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-sm">
          <h3 className="text-lg font-bold text-stone-900 mb-4 flex items-center gap-2">
            <List className="w-5 h-5 text-[#588157]" />
            <span>Producción Global Pendiente ({stationFilter === 'ALL' ? 'Cocina y Bar' : stationFilter})</span>
          </h3>
          {consolidatedItems.length === 0 ? (
            <p className="text-sm text-stone-500 py-8 text-center bg-stone-50 rounded-2xl border border-dashed border-stone-200">
              No hay platillos ni bebidas pendientes.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {consolidatedItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-stone-50 border border-stone-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-stone-900 text-[#a9b994] flex items-center justify-center font-black text-lg shadow-sm">
                      {item.total}
                    </div>
                    <div>
                      <h4 className="font-bold text-stone-900 leading-tight">{item.name}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">{item.station}</span>
                        {item.completed > 0 && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {item.completed} listos
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {filteredOrders.map((order) => {
          const mins = getElapsedTimeInMinutes(order.timestamp);
          
          // Calculate max prep time
          let maxPrepTime = 15; // default 15 mins if no items have prepTime
          let hasPrepTime = false;
          
          order.items.forEach(it => {
            const menuItem = menuItems.find(m => m.name === it.name);
            if (menuItem?.prepTime) {
              if (!hasPrepTime) {
                maxPrepTime = menuItem.prepTime;
                hasPrepTime = true;
              } else if (menuItem.prepTime > maxPrepTime) {
                maxPrepTime = menuItem.prepTime;
              }
            }
          });
          
          const adjustedPrepTime = Math.ceil(maxPrepTime * loadMultiplier);
          const isUrgent = mins >= adjustedPrepTime;
          const isWarning = mins >= (adjustedPrepTime * 0.75) && mins < adjustedPrepTime;

          return (
            <div
              key={order.id}
              className={`rounded-3xl border bg-white p-5 flex flex-col justify-between transition-all shadow-xs relative overflow-hidden ${
                order.status === 'READY'
                  ? 'border-emerald-300 ring-2 ring-emerald-300/60 bg-emerald-50/10'
                  : isUrgent
                  ? 'border-red-400 ring-2 ring-red-400/80 bg-red-50/20 shadow-[0_0_15px_rgba(248,113,113,0.3)] animate-pulse'
                  : isWarning
                  ? 'border-amber-300 ring-1 ring-amber-200/60'
                  : 'border-stone-200'
              }`}
            >
              {/* Urgent visual bar */}
              {isUrgent && order.status !== 'READY' && order.status !== 'SERVED' && (
                <div className="absolute top-0 left-0 w-full h-1.5 bg-red-500 animate-pulse" />
              )}
              <div>
                {/* Header info */}
                <div className="flex items-start justify-between pb-3 border-b border-stone-100 mb-3">
                  <div>
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                      {order.station}
                    </span>
                    <h3 className="text-lg font-black text-stone-900 leading-tight">
                      Mesa {order.tableNumber}
                    </h3>
                    <p className="text-xs text-stone-500">{order.server}</p>
                  </div>

                  <div className={`flex flex-col items-end gap-0.5`}>
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold ${
                      isUrgent 
                        ? 'bg-red-500 text-white' 
                        : isWarning 
                        ? 'bg-amber-500 text-white' 
                        : 'bg-stone-100 text-stone-800'
                    }`}>
                      <Clock className="w-3.5 h-3.5" />
                      <span>{mins} min</span>
                    </div>
                    {order.status !== 'READY' && order.status !== 'SERVED' && (
                      <span className="text-[9px] font-bold text-stone-400">Meta: {adjustedPrepTime}m</span>
                    )}
                  </div>
                </div>

                {/* Items List */}
                <div className="space-y-2 mb-4">
                  {order.items.map((it, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => order.status !== 'SERVED' && it.id && handleToggleItemCompletion(order.id, it.id)}
                      className={`p-2.5 rounded-2xl border text-xs transition-colors ${
                        order.status !== 'SERVED' && it.id ? 'cursor-pointer' : ''
                      } ${
                        it.completed 
                          ? 'bg-emerald-50/50 border-emerald-100 text-stone-500' 
                          : 'bg-stone-50 border-stone-100 text-stone-900'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {/* Checkbox */}
                        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          it.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 bg-white'
                        }`}>
                          {it.completed && <CheckCircle className="w-3 h-3" />}
                        </div>
                        
                        <div className="flex-1">
                          <div className={`flex items-center justify-between font-bold ${it.completed ? 'line-through text-stone-400' : 'text-stone-900'}`}>
                            <span className="text-sm font-black w-7">{it.quantity}x</span>
                            <span className="flex-1">{it.name}</span>
                          </div>
                          {it.notes && (
                            <p className={`text-[11px] font-medium italic mt-1 pl-7 ${it.completed ? 'text-stone-400 line-through' : 'text-amber-800'}`}>
                              Nota: {it.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Status Action Buttons with Sounds */}
              <div className="pt-3 border-t border-stone-100">
                {order.status === 'PENDING' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'IN_PREPARATION')}
                    className="w-full py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <Flame className="w-3.5 h-3.5 text-[#a9b994]" />
                    <span>Iniciar Preparación</span>
                  </button>
                )}

                {order.status === 'IN_PREPARATION' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'READY')}
                    className="w-full py-2.5 bg-[#588157] text-white rounded-xl text-xs font-bold hover:bg-[#476c46] transition-colors flex items-center justify-center gap-1.5 shadow-xs ring-2 ring-[#588157]/40 animate-pulse"
                    title="Suena campana y avisa al salonero"
                  >
                    <Bell className="w-3.5 h-3.5 text-[#a9b994]" />
                    <span>Marcar Listo (Avisar Salonero)</span>
                  </button>
                )}

                {order.status === 'READY' && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'SERVED')}
                    className="w-full py-2.5 bg-emerald-700 text-white rounded-xl text-xs font-bold hover:bg-emerald-800 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Despachar a Mesa</span>
                  </button>
                )}

                {order.status === 'SERVED' && (
                  <div className="w-full py-2 text-center text-xs font-bold text-stone-400 bg-stone-50 rounded-xl">
                    Servido ✓
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

    </div>
  );
};
