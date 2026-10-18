import React, { useState, useMemo } from 'react';
import { getTenantItem } from '../services/tenantStorage';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  CreditCard, 
  Wallet,
  Calendar,
  Download,
  Filter,
  Users,
  Award,
  Receipt,
  Sparkles,
  PieChart
} from 'lucide-react';
import { TenantInfo, UserProfile } from '../types';
import { cashShiftService } from '../services/cashShiftService';
import { haciendaService } from '../services/haciendaService';

interface ReportsDashboardProps {
  tenant: TenantInfo;
}

export const ReportsDashboard: React.FC<ReportsDashboardProps> = ({ tenant }) => {
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today');

  // Load staff list for tip liquidation calculations
  const staffList: UserProfile[] = useMemo(() => {
    try {
      const saved = getTenantItem<any[]>('staff');
      if (saved) return saved;
    } catch {}
    return [];
  }, []);

  const activeStaff = useMemo(() => {
    const list = staffList.filter(s => s.active !== false);
    return list.length > 0 ? list : [{ id: '1', name: 'Personal de Salón y Cocina', email: '', role: 'SALONERO' }];
  }, [staffList]);

  // Helper date checker
  const isWithinRange = (dateString: string | Date | undefined, range: 'today' | 'week' | 'month') => {
    if (!dateString) return false;
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return false;
    const now = new Date();

    if (range === 'today') {
      return (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    }

    if (range === 'week') {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= oneWeekAgo && d <= now;
    }

    if (range === 'month') {
      return (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    }

    return true;
  };

  // 1. Filter Shifts according to range
  const activeShift = cashShiftService.getActiveShift();
  const history = cashShiftService.getShiftsHistory();
  const allShifts = useMemo(() => {
    const raw = [...(activeShift ? [activeShift] : []), ...history];
    return raw.filter(s => isWithinRange(s.openedAt, dateRange));
  }, [activeShift, history, dateRange]);

  // 2. Filter Invoices according to range
  const allInvoices = haciendaService.getInvoices();
  const filteredInvoices = useMemo(() => {
    return allInvoices.filter(inv => isWithinRange(inv.fechaEmision, dateRange));
  }, [allInvoices, dateRange]);

  // Combined metrics from shifts & invoices
  const totalSalesFromInvoices = filteredInvoices.reduce((sum, i) => sum + (i.totalComprobante || 0), 0);
  const totalSalesFromShifts = allShifts.reduce((sum, s) => sum + (s.systemSummary?.totalSales || 0), 0);
  const totalSales = Math.max(totalSalesFromInvoices, totalSalesFromShifts);

  const totalTipsFromInvoices = filteredInvoices.reduce((sum, i) => sum + (i.servicio10 || 0), 0);
  const totalTipsFromShifts = allShifts.reduce((sum, s) => sum + (s.systemSummary?.serviceTax10 || 0), 0);
  const totalTips = Math.max(totalTipsFromInvoices, totalTipsFromShifts);

  const totalTrx = Math.max(filteredInvoices.length, allShifts.reduce((sum, s) => sum + (s.systemSummary?.invoicesCount || 0), 0));
  const avgTicket = totalTrx > 0 ? Math.round(totalSales / totalTrx) : 0;

  const cashSales = allShifts.reduce((sum, s) => sum + (s.systemSummary?.cashSales || 0), 0);
  const cardSales = allShifts.reduce((sum, s) => sum + (s.systemSummary?.cardSales || 0), 0);
  const sinpeSales = allShifts.reduce((sum, s) => sum + (s.systemSummary?.sinpeSales || 0), 0);

  // Top 5 Most Sold Dishes
  const topDishes = useMemo(() => {
    const dishCounts: Record<string, { name: string; quantity: number; revenue: number }> = {};

    filteredInvoices.forEach(inv => {
      (inv.items || []).forEach(item => {
        if (!dishCounts[item.name]) {
          dishCounts[item.name] = { name: item.name, quantity: 0, revenue: 0 };
        }
        dishCounts[item.name].quantity += (item.quantity || 1);
        dishCounts[item.name].revenue += ((item.price || 0) * (item.quantity || 1));
      });
    });

    const list = Object.values(dishCounts).sort((a, b) => b.quantity - a.quantity);
    return list.slice(0, 5);
  }, [filteredInvoices]);

  const totalDishesSold = topDishes.reduce((sum, d) => sum + d.quantity, 0);

  // Real Recent Transactions list
  const recentTransactions = useMemo(() => {
    const list: { id: string; time: string; amount: number; method: string; server: string; rawDate: Date }[] = [];

    // From Invoices
    filteredInvoices.forEach(inv => {
      list.push({
        id: inv.consecutivo ? `#${inv.consecutivo.slice(-6)}` : `#${inv.clave50Digitos.slice(-6)}`,
        time: new Date(inv.fechaEmision).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
        amount: inv.totalComprobante,
        method: inv.medioPago || 'Efectivo',
        server: inv.receptor?.nombre || 'Cliente General',
        rawDate: new Date(inv.fechaEmision)
      });
    });

    // From Shift Movements if invoices are empty
    if (list.length === 0) {
      allShifts.forEach(s => {
        (s.movements || []).forEach(t => {
          if (t.type === 'INFLOW' || t.amount > 0) {
            list.push({
              id: `#${t.id.slice(-6)}`,
              time: new Date(t.timestamp).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
              amount: t.amount,
              method: t.reason || 'Efectivo',
              server: t.performedBy || 'Cajero',
              rawDate: new Date(t.timestamp)
            });
          }
        });
      });
    }

    return list.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime()).slice(0, 8);
  }, [filteredInvoices, allShifts]);

  // Per-staff tip distribution (Ley N° 4946)
  const tipPerStaff = activeStaff.length > 0 ? Math.round(totalTips / activeStaff.length) : totalTips;

  return (
    <div className="w-full h-full flex flex-col bg-stone-50 overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-none p-6 md:p-8 flex flex-col md:flex-row md:items-end justify-between gap-4 z-10 border-b border-stone-200/80 bg-white/50 backdrop-blur-sm">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-[#588157]" />
            Reportes Financieros & Operativos
          </h1>
          <p className="text-stone-500 font-medium text-xs md:text-sm mt-1">
            Métricas de ventas en tiempo real, escandallos, métodos de pago y liquidación de propina de ley.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-white p-1 rounded-2xl border border-stone-200 shadow-xs">
            <button
              onClick={() => setDateRange('today')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dateRange === 'today' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Hoy
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dateRange === 'week' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Esta Semana
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                dateRange === 'month' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Este Mes
            </button>
          </div>

          <button 
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-[#588157] text-white hover:bg-[#476c46] rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 space-y-6">
        
        {/* KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-stone-200/90 shadow-xs hover:border-[#588157]/40 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-emerald-50 text-emerald-700 rounded-2xl">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                <TrendingUp className="w-3 h-3" /> Real
              </span>
            </div>
            <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Ventas Totales</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{totalSales.toLocaleString()}</h3>
            <p className="text-[11px] text-stone-400 mt-1">
              Filtro: {dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Últimos 7 días' : 'Mes en curso'}
            </p>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200/90 shadow-xs hover:border-blue-300 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-blue-50 text-blue-700 rounded-2xl">
                <Receipt className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                {totalTrx} tickets
              </span>
            </div>
            <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Transacciones</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">{totalTrx}</h3>
            <p className="text-[11px] text-stone-400 mt-1">
              Comprobantes emitidos y cobrados
            </p>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200/90 shadow-xs hover:border-amber-300 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-amber-50 text-amber-700 rounded-2xl">
                <Wallet className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                Ley N° 4946
              </span>
            </div>
            <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Propinas (Servicio 10%)</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{totalTips.toLocaleString()}</h3>
            <p className="text-[11px] text-stone-400 mt-1">
              Para distribución al personal
            </p>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200/90 shadow-xs hover:border-purple-300 transition-colors">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-purple-50 text-purple-700 rounded-2xl">
                <CreditCard className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Ticket Promedio</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{avgTicket.toLocaleString()}</h3>
            <p className="text-[11px] text-stone-400 mt-1">
              Gasto promedio por mesa/cliente
            </p>
          </div>
        </div>

        {/* TOP 5 DISHES & PAYMENT METHODS ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Top 5 Platillos Más Vendidos (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-stone-200 shadow-xs p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Top 5 Platillos Más Vendidos</h3>
                  <p className="text-[11px] text-stone-400">Favoritos de los comensales por volumen y facturación</p>
                </div>
              </div>
              <span className="text-xs font-bold text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full">
                {totalDishesSold} ítems
              </span>
            </div>

            {topDishes.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                🍽️ No hay platillos registrados en el rango seleccionado. Los productos aparecerán al facturar comandas.
              </div>
            ) : (
              <div className="space-y-3.5">
                {topDishes.map((dish, idx) => {
                  const pct = totalDishesSold > 0 ? Math.round((dish.quantity / totalDishesSold) * 100) : 0;
                  return (
                    <div key={dish.name} className="p-3 bg-stone-50/70 hover:bg-stone-50 rounded-2xl border border-stone-100 transition-colors">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] ${
                            idx === 0 ? 'bg-amber-400 text-stone-900 shadow-xs' :
                            idx === 1 ? 'bg-stone-300 text-stone-800' :
                            idx === 2 ? 'bg-amber-700/60 text-white' :
                            'bg-stone-200 text-stone-600'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className="font-bold text-stone-900">{dish.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-stone-500">{dish.quantity} uds.</span>
                          <span className="font-black text-stone-900">₡{dish.revenue.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-stone-200/80 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            idx === 0 ? 'bg-[#588157]' : idx === 1 ? 'bg-stone-700' : 'bg-stone-400'
                          }`} 
                          style={{ width: `${Math.max(pct, 5)}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Métodos de Pago (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-stone-200 shadow-xs p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                  <PieChart className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Desglose por Medio de Pago</h3>
                  <p className="text-[11px] text-stone-400">Distribución de recaudación en caja</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-stone-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500" /> Tarjeta Débito / Crédito
                    </span>
                    <span className="text-stone-900 font-mono">₡{cardSales.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${totalSales > 0 ? (cardSales / totalSales) * 100 : 0}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-stone-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Efectivo en Colones/USD
                    </span>
                    <span className="text-stone-900 font-mono">₡{cashSales.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${totalSales > 0 ? (cashSales / totalSales) * 100 : 0}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-stone-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" /> SINPE Móvil
                    </span>
                    <span className="text-stone-900 font-mono">₡{sinpeSales.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${totalSales > 0 ? (sinpeSales / totalSales) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-[#a9b994]/15 rounded-2xl border border-[#a9b994]/30">
              <div className="text-[10px] font-bold text-stone-500 uppercase text-center mb-0.5">Canal Más Utilizado</div>
              <div className="text-center font-black text-stone-900 text-base">
                {cardSales >= cashSales && cardSales >= sinpeSales ? 'Tarjeta Bancaria' :
                 cashSales >= sinpeSales ? 'Efectivo en Caja' : 'SINPE Móvil'}
              </div>
            </div>
          </div>

        </div>

        {/* LEY N° 4946 PROPINAS & RECENT TRANSACTIONS ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Liquidación de Propinas al Personal (Ley N° 4946) (5 cols) */}
          <div className="lg:col-span-5 bg-gradient-to-br from-white to-amber-50/40 rounded-3xl border border-amber-200/80 shadow-xs p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Liquidación de Propinas (Ley N° 4946)</h3>
                  <p className="text-[11px] text-amber-900/70">10% Servicio de Mesa en Costa Rica</p>
                </div>
              </div>

              <div className="p-4 bg-white/80 rounded-2xl border border-amber-200/60 space-y-3 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-600">Total Propinas Recaudadas:</span>
                  <span className="text-lg font-black text-stone-900">₡{totalTips.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-stone-100">
                  <span className="text-xs font-semibold text-stone-600">Colaboradores Activos:</span>
                  <span className="text-xs font-bold text-stone-900">{activeStaff.length} personas</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-stone-100">
                  <span className="text-xs font-black text-emerald-800">Monto Estimado por Colaborador:</span>
                  <span className="text-base font-black text-emerald-700">₡{tipPerStaff.toLocaleString()}</span>
                </div>
              </div>

              <p className="text-[11px] text-stone-500 leading-relaxed">
                Según la Ley costarricense N° 4946, el 10% cobrado por concepto de servicio es propiedad exclusiva de los trabajadores de salón y cocina, debiendo liquidarse íntegramente de forma periódica.
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-amber-100 flex items-center justify-between">
              <span className="text-[11px] font-bold text-stone-500">Estado de Liquidación:</span>
              <span className="text-xs font-black px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                Pendiente de Corte
              </span>
            </div>
          </div>

          {/* Últimas Transacciones Reales (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-stone-200 shadow-xs p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-stone-100 text-stone-700 flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900">Últimas Transacciones Registradas</h3>
                  <p className="text-[11px] text-stone-400">Comprobantes y pagos emitidos en el período</p>
                </div>
              </div>
              <span className="text-xs font-bold text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full">
                {recentTransactions.length} recientes
              </span>
            </div>

            {recentTransactions.length === 0 ? (
              <div className="py-12 text-center text-stone-400 text-xs">
                No hay transacciones registradas en este período. Las ventas aparecerán aquí conforme se emitan tiquetes o facturas.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-100 text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                      <th className="pb-2.5 px-2">ID</th>
                      <th className="pb-2.5 px-2">Hora</th>
                      <th className="pb-2.5 px-2">Receptor / Mesa</th>
                      <th className="pb-2.5 px-2">Método</th>
                      <th className="pb-2.5 px-2 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-medium text-stone-700 divide-y divide-stone-50">
                    {recentTransactions.map((trx, idx) => (
                      <tr key={idx} className="hover:bg-stone-50/70 transition-colors">
                        <td className="py-2.5 px-2 font-mono text-stone-500 text-[11px]">{trx.id}</td>
                        <td className="py-2.5 px-2 text-stone-500 text-[11px]">{trx.time}</td>
                        <td className="py-2.5 px-2 font-bold text-stone-900 truncate max-w-[140px]">{trx.server}</td>
                        <td className="py-2.5 px-2">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            trx.method.toLowerCase().includes('tarjeta') ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                            trx.method.toLowerCase().includes('efectivo') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {trx.method}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-black text-stone-900">
                          ₡{trx.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
