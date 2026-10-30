import React, { useMemo, useState } from 'react';
import { BriefcaseBusiness, Search, X } from 'lucide-react';
import { UserProfile } from '../types';
import { employeeCreditService } from '../services/employeeCreditService';

interface ExecutiveOrderModalProps {
  isOpen: boolean;
  staffList: UserProfile[];
  onClose: () => void;
  onSelectEmployee: (employee: UserProfile) => void;
  tenantId: string;
  onRecordPayment: (employee: UserProfile, amount: number) => void;
}

export const ExecutiveOrderModal: React.FC<ExecutiveOrderModalProps> = ({ isOpen, staffList, onClose, onSelectEmployee, tenantId, onRecordPayment }) => {
  const [search, setSearch] = useState('');
  const [paymentEmployee, setPaymentEmployee] = useState<UserProfile | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const activeStaff = useMemo(() => staffList.filter(staff => staff.active !== false && (
    staff.name.toLowerCase().includes(search.toLowerCase()) || staff.role.toLowerCase().includes(search.toLowerCase())
  )), [staffList, search]);
  const balances = useMemo(() => new Map(staffList.map(staff => [staff.id, employeeCreditService.getBalance(tenantId, staff.id)])), [staffList, tenantId, ledgerVersion]);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-stone-200 overflow-hidden">
        <header className="px-6 py-5 bg-stone-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3"><BriefcaseBusiness className="w-5 h-5 text-[#a9b994]" /><div><h2 className="font-bold">Comanda Ejecutiva</h2><p className="text-[11px] text-stone-300">Selecciona el colaborador responsable del crédito</p></div></div>
          <button onClick={onClose} className="p-2 text-stone-300 hover:text-white"><X className="w-5 h-5" /></button>
        </header>
        <div className="p-5 space-y-4">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar trabajador..." className="w-full pl-9 pr-3 py-3 rounded-xl border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#588157]/30" /></div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {activeStaff.map(employee => <div key={employee.id} className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border border-stone-200 hover:border-[#588157] hover:bg-[#a9b994]/10 transition-colors"><button onClick={() => { onSelectEmployee(employee); setSearch(''); }} className="flex-1 text-left"><strong className="block text-sm text-stone-900">{employee.name}</strong><span className="text-[11px] text-stone-500">{employee.role} · Saldo: <b className={balances.get(employee.id) ? 'text-amber-700' : 'text-emerald-700'}>₡{(balances.get(employee.id) || 0).toLocaleString('es-CR')}</b></span></button><div className="flex items-center gap-2"><button onClick={() => { setPaymentEmployee(employee); setPaymentAmount(String(Math.min(balances.get(employee.id) || 0, balances.get(employee.id) || 0))); }} disabled={!balances.get(employee.id)} className="text-[10px] font-bold text-stone-600 disabled:text-stone-300">Abonar</button><button onClick={() => { onSelectEmployee(employee); setSearch(''); }} className="text-xs font-bold text-[#588157]">Nueva comanda</button></div></div>)}
            {activeStaff.length === 0 && <p className="py-8 text-center text-sm text-stone-400">No hay trabajadores que coincidan.</p>}
          </div>
          {paymentEmployee && (
            <form onSubmit={event => { event.preventDefault(); const amount = Number(paymentAmount); if (amount > 0) { onRecordPayment(paymentEmployee, amount); setPaymentEmployee(null); setPaymentAmount(''); setLedgerVersion(version => version + 1); } }} className="p-3 rounded-2xl border border-emerald-200 bg-emerald-50 space-y-2">
              <div className="text-xs font-bold text-emerald-950">Registrar abono de {paymentEmployee.name}</div>
              <div className="flex gap-2"><input autoFocus type="number" min="1" step="1" max={balances.get(paymentEmployee.id) || 0} value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} className="flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" placeholder="Monto en colones" /><button type="submit" className="px-3 rounded-xl bg-emerald-700 text-white text-xs font-bold">Guardar pago</button></div>
            </form>
          )}
          <p className="text-[11px] text-stone-500 bg-amber-50 border border-amber-200 rounded-xl p-3">La factura se emitirá con condición de venta crédito. El monto no se registra como efectivo, tarjeta ni SINPE; quedará como saldo por cobrar al trabajador.</p>
        </div>
      </div>
    </div>
  );
};
