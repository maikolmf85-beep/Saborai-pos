import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  CreditCard, 
  Wallet,
  Calendar,
  Download,
  Filter,
  Users
} from 'lucide-react';
import { TenantInfo } from '../types';
import { cashShiftService } from '../services/cashShiftService';

interface ReportsDashboardProps {
  tenant: TenantInfo;
}

export const ReportsDashboard: React.FC<ReportsDashboardProps> = ({ tenant }) => {
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today');

  // Simulated metrics
  const metrics = {
    today: {
      sales: 458900,
      tips: 45890,
      transactions: 142,
      avgTicket: 3231,
      cash: 120000,
      card: 280500,
      sinpe: 58400
    },
    week: {
      sales: 3254000,
      tips: 325400,
      transactions: 954,
      avgTicket: 3410,
      cash: 850000,
      card: 1954000,
      sinpe: 450000
    },
    month: {
      sales: 14580000,
      tips: 1458000,
      transactions: 4250,
      avgTicket: 3430,
      cash: 3800000,
      card: 8900000,
      sinpe: 1880000
    }
  }[dateRange];

  const recentTransactions = [
    { id: 'TRX-1029', time: '14:23', amount: 15400, method: 'Tarjeta', server: 'Carlos G.' },
    { id: 'TRX-1028', time: '14:15', amount: 8500, method: 'Efectivo', server: 'María P.' },
    { id: 'TRX-1027', time: '13:58', amount: 24300, method: 'SINPE Móvil', server: 'Carlos G.' },
    { id: 'TRX-1026', time: '13:45', amount: 4500, method: 'Efectivo', server: 'Juan L.' },
    { id: 'TRX-1025', time: '13:30', amount: 32000, method: 'Tarjeta', server: 'María P.' },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-stone-50 overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-none p-6 md:p-8 flex flex-col md:flex-row md:items-end justify-between gap-4 z-10">
        <div>
          <h1 className="text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-[#588157]" />
            Reportes y Estadísticas
          </h1>
          <p className="text-stone-500 font-medium mt-1">
            Métricas de ventas, métodos de pago y rendimiento del equipo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-white p-1 rounded-xl border border-stone-200 shadow-xs">
            <button
              onClick={() => setDateRange('today')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                dateRange === 'today' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Hoy
            </button>
            <button
              onClick={() => setDateRange('week')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                dateRange === 'week' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Esta Semana
            </button>
            <button
              onClick={() => setDateRange('month')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                dateRange === 'month' ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Este Mes
            </button>
          </div>
          <button className="p-2 bg-white text-stone-700 hover:bg-stone-100 border border-stone-200 rounded-xl transition-colors" title="Filtros avanzados">
            <Filter className="w-4 h-4" />
          </button>
          <button className="px-3 py-2 bg-[#588157] text-white hover:bg-[#4a6b49] rounded-xl text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Exportar PDF</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 md:px-8 pb-8 z-10 space-y-6 custom-scrollbar">
        
        {/* KPI CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                <TrendingUp className="w-3 h-3" /> +12.5%
              </span>
            </div>
            <p className="text-xs font-bold text-stone-500 uppercase">Ventas Totales</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{metrics.sales.toLocaleString()}</h3>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs font-bold text-stone-500 uppercase">Transacciones</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">{metrics.transactions} <span className="text-sm font-medium text-stone-500">tickets</span></h3>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs font-bold text-stone-500 uppercase">Propinas (Servicio 10%)</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{metrics.tips.toLocaleString()}</h3>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-stone-200 shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl">
                <CreditCard className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs font-bold text-stone-500 uppercase">Ticket Promedio</p>
            <h3 className="text-2xl font-black text-stone-900 mt-1">₡{metrics.avgTicket.toLocaleString()}</h3>
          </div>
        </div>

        {/* CHARTS & DETAILS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Métodos de Pago */}
          <div className="bg-white rounded-3xl border border-stone-200 shadow-xs p-6 lg:col-span-1">
            <h3 className="text-sm font-bold text-stone-800 mb-6 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-stone-400" />
              Ingresos por Método de Pago
            </h3>
            
            <div className="space-y-5">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-600">Tarjeta</span>
                  <span className="text-stone-900">₡{metrics.card.toLocaleString()}</span>
                </div>
                <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(metrics.card / metrics.sales) * 100}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-600">Efectivo</span>
                  <span className="text-stone-900">₡{metrics.cash.toLocaleString()}</span>
                </div>
                <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(metrics.cash / metrics.sales) * 100}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold mb-1.5">
                  <span className="text-stone-600">SINPE Móvil</span>
                  <span className="text-stone-900">₡{metrics.sinpe.toLocaleString()}</span>
                </div>
                <div className="w-full h-2.5 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(metrics.sinpe / metrics.sales) * 100}%` }}></div>
                </div>
              </div>
            </div>
            
            <div className="mt-8 p-4 bg-stone-50 rounded-2xl border border-stone-100">
              <div className="text-[10px] font-bold text-stone-500 uppercase text-center mb-1">Método Principal</div>
              <div className="text-center font-black text-stone-800 text-lg">Tarjeta ({Math.round((metrics.card / metrics.sales) * 100)}%)</div>
            </div>
          </div>

          {/* Últimas transacciones */}
          <div className="bg-white rounded-3xl border border-stone-200 shadow-xs p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-stone-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-stone-400" />
                Últimas Transacciones
              </h3>
              <button className="text-[11px] font-bold text-[#588157] hover:text-[#4a6b49]">
                Ver Todas
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-100 text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                    <th className="pb-3 px-2">ID</th>
                    <th className="pb-3 px-2">Hora</th>
                    <th className="pb-3 px-2">Mesero/a</th>
                    <th className="pb-3 px-2">Método</th>
                    <th className="pb-3 px-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-medium text-stone-700 divide-y divide-stone-50">
                  {recentTransactions.map((trx) => (
                    <tr key={trx.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="py-3 px-2 font-mono text-stone-500">{trx.id}</td>
                      <td className="py-3 px-2">{trx.time}</td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-stone-200 flex items-center justify-center text-[9px] font-black text-stone-600">
                            {trx.server.charAt(0)}
                          </div>
                          {trx.server}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          trx.method === 'Tarjeta' ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                          trx.method === 'Efectivo' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                          'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {trx.method}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-black text-stone-900">
                        ₡{trx.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Disclaimer for mockup */}
            <div className="mt-4 text-center">
               <p className="text-[10px] text-stone-400 italic">Datos de demostración. En la versión final se conectarán con el cierre de caja real.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
