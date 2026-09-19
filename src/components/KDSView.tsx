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
import { KDSOrder } from '../types';
import { soundService } from '../services/soundEffects';
import { PosNotification } from './NotificationToast';

interface KDSViewProps {
  onNotify?: (notif: PosNotification) => void;
}

export const KDSView: React.FC<KDSViewProps> = ({ onNotify }) => {
  const [stationFilter, setStationFilter] = useState<'ALL' | 'Cocina' | 'Bar'>('ALL');
  const [viewMode, setViewMode] = useState<'TICKETS' | 'CONSOLIDATED'>('TICKETS');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000); // 10s for better responsiveness
    return () => clearInterval(interval);
  }, []);
  
  const [orders, setOrders] = useState<KDSOrder[]>([
    {
      id: 'kds_1',
      tableNumber: 1,
      tableName: 'Mesa 1 - Ventanal',
      server: 'Kevin Murillo',
      timestamp: new Date(Date.now() - 14 * 60 * 1000), // 14 mins ago
      status: 'IN_PREPARATION',
      station: 'Cocina',
      items: [
        { id: 'i1', name: 'Ceviche Tico Clásico de Corvina', quantity: 2, notes: 'Sin cebolla para uno', completed: false },
        { id: 'i2', name: 'Corte Ribeye Angus 350g a la Leña', quantity: 1, notes: 'Término medio 3/4', completed: false },
      ]
    },
    {
      id: 'kds_2',
      tableNumber: 1,
      tableName: 'Mesa 1 - Ventanal',
      server: 'Kevin Murillo',
      timestamp: new Date(Date.now() - 14 * 60 * 1000),
      status: 'READY',
      station: 'Bar',
      items: [
        { id: 'i3', name: 'Cóctel Pasión Tica (Guaro Cacique)', quantity: 2, completed: true },
      ]
    },
    {
      id: 'kds_3',
      tableNumber: 6,
      tableName: 'Barra VIP Banqueta 1-4',
      server: 'Esteban Mora',
      timestamp: new Date(Date.now() - 4 * 60 * 1000), // 4 mins ago
      status: 'PENDING',
      station: 'Bar',
      items: [
        { id: 'i4', name: 'Cóctel Pasión Tica (Guaro Cacique)', quantity: 3, completed: false },
      ]
    },
    {
      id: 'kds_4',
      tableNumber: 3,
      tableName: 'Mesa 3 - Rincón Íntimo',
      server: 'Sofía Calderón',
      timestamp: new Date(Date.now() - 22 * 60 * 1000), // 22 mins ago (Alert!)
      status: 'IN_PREPARATION',
      station: 'Cocina',
      items: [
        { id: 'i5', name: 'Gallo Pinto Gourmet con Lomo Saltado', quantity: 2, completed: false },
      ]
    }
  ]);

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

    setOrders(orders.map(o => o.id === orderId ? { ...o, status: nextStatus, items: nextStatus === 'READY' ? o.items.map(it => ({...it, completed: true})) : o.items } : o));
  };

  const handleToggleItemCompletion = (orderId: string, itemId: string) => {
    setOrders(orders.map(order => {
      if (order.id !== orderId) return order;

      const updatedItems = order.items.map(it => 
        it.id === itemId ? { ...it, completed: !it.completed } : it
      );
      
      const allCompleted = updatedItems.length > 0 && updatedItems.every(it => it.completed);
      
      let nextStatus = order.status;
      if (allCompleted && order.status !== 'READY' && order.status !== 'SERVED') {
        nextStatus = 'READY';
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

      return { ...order, items: updatedItems, status: nextStatus };
    }));
  };

  const handleSimulateNewOrderArrival = () => {
    const randomStation = Math.random() > 0.5 ? 'Cocina' : 'Bar';
    soundService.playNewOrderSound(randomStation);

    const newOrder: KDSOrder = {
      id: `kds_${Date.now()}`,
      tableNumber: Math.floor(1 + Math.random() * 6),
      tableName: `Mesa ${Math.floor(1 + Math.random() * 6)} - Salón`,
      server: 'Kevin Murillo',
      timestamp: new Date(),
      status: 'PENDING',
      station: randomStation,
      items: randomStation === 'Cocina' ? [
        { id: `i_${Date.now()}_1`, name: 'Gallo Pinto Gourmet con Lomo Saltado', quantity: 1, notes: 'Huevo frito suave', completed: false }
      ] : [
        { id: `i_${Date.now()}_2`, name: 'Cóctel Pasión Tica (Guaro Cacique)', quantity: 2, completed: false }
      ]
    };

    setOrders([newOrder, ...orders]);

    if (onNotify) {
      onNotify({
        id: `arrival_${Date.now()}`,
        type: 'NEW_ORDER',
        title: `🔔 Nueva Comanda recibida en ${randomStation}`,
        message: `${newOrder.tableName} (Salonero: ${newOrder.server})`,
        station: randomStation,
        tableNumber: newOrder.tableNumber,
        server: newOrder.server,
        timestamp: new Date()
      });
    }
  };

  const filteredOrders = stationFilter === 'ALL'
    ? orders
    : orders.filter(o => o.station === stationFilter);

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

          {/* Test Sound Button */}
          <button
            type="button"
            onClick={handleSimulateNewOrderArrival}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition-all border border-stone-200"
            title="Probar sonido y llegada de nueva comanda a Cocina o Bar"
          >
            <Bell className="w-3.5 h-3.5 text-[#588157] animate-bounce" />
            <span>Simular Llegada</span>
          </button>

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
          const isUrgent = mins >= 18;
          const isWarning = mins >= 10 && mins < 18;

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

                  {/* Timer Pill */}
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
