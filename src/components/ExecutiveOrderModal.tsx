import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleDollarSign,
  History,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  Wallet,
  X
} from 'lucide-react';
import type { UserProfile } from '../types';
import {
  employeeCreditService,
  getSelectableEmployees,
  type EmployeeCreditEmployee,
  type EmployeeCreditLedger,
  type EmployeeCreditTransaction
} from '../services/employeeCreditService';

type ExecutiveOrderView = 'new-order' | 'ledger';

interface ExecutiveOrderModalProps {
  isOpen: boolean;
  staffList: UserProfile[];
  ownerUserId?: string | null;
  onClose: () => void;
  onSelectEmployee: (employee: Pick<UserProfile, 'id' | 'name'>) => void;
  tenantId: string;
  currency?: 'CRC' | 'USD';
  isOnline?: boolean;
  initialView?: ExecutiveOrderView;
  onRecordPayment: (employee: Pick<UserProfile, 'id' | 'name'>, amount: number, idempotencyKey: string) => Promise<void>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function transactionTitle(transaction: EmployeeCreditTransaction): string {
  if (transaction.type === 'CHARGE') return transaction.orderNumber ? `Consumo · ${transaction.orderNumber}` : 'Consumo registrado';
  if (transaction.type === 'PAYMENT') return 'Abono recibido';
  if (transaction.type === 'VOID') return 'Anulación de consumo';
  return 'Ajuste de saldo';
}

export const ExecutiveOrderModal: React.FC<ExecutiveOrderModalProps> = ({
  isOpen,
  staffList,
  ownerUserId,
  onClose,
  onSelectEmployee,
  tenantId,
  currency = 'CRC',
  isOnline = true,
  initialView = 'new-order',
  onRecordPayment
}) => {
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState<ExecutiveOrderView>(initialView);
  const [ledger, setLedger] = useState<EmployeeCreditLedger>(() => employeeCreditService.getLedger(tenantId));
  const [loading, setLoading] = useState(isOpen);
  const [refreshing, setRefreshing] = useState(false);
  const [serverRosterLoaded, setServerRosterLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedLedgerEmployee, setSelectedLedgerEmployee] = useState<EmployeeCreditEmployee | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentAttempt, setPaymentAttempt] = useState<{ employeeId: string; amount: number; key: string } | null>(null);

  const currencyFormatter = useMemo(() => new Intl.NumberFormat('es-CR', { style: 'currency', currency }), [currency]);
  const cachedEmployees = useMemo(() => getSelectableEmployees(staffList, ownerUserId), [staffList, ownerUserId]);
  const selectionEmployees = useMemo(
    () => serverRosterLoaded ? ledger.employees.filter(employee => employee.active) : cachedEmployees,
    [serverRosterLoaded, ledger.employees, cachedEmployees]
  );
  const searchedEmployees = useMemo(() => selectionEmployees.filter(employee =>
    employee.name.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  ), [selectionEmployees, search]);

  const ledgerEmployees = useMemo(() => {
    const employees = new Map<string, EmployeeCreditEmployee>();
    ledger.employees.forEach(employee => employees.set(employee.id, employee));
    ledger.accounts.forEach(account => {
      const previous = employees.get(account.employeeId);
      employees.set(account.employeeId, {
        id: account.employeeId,
        name: account.employeeName || previous?.name || 'Colaborador',
        active: previous?.active ?? false
      });
    });
    return [...employees.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'));
  }, [ledger.employees, ledger.accounts]);
  const totalDebt = useMemo(() => ledger.accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0), [ledger.accounts]);
  const visibleLedgerEmployees = useMemo(() => ledgerEmployees.filter(employee =>
    employee.name.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  ), [ledgerEmployees, search]);
  const selectedBalance = selectedLedgerEmployee
    ? ledger.accounts.find(account => account.employeeId === selectedLedgerEmployee.id)?.balance || 0
    : 0;
  const employeeTransactions = useMemo(() => selectedLedgerEmployee
    ? ledger.transactions.filter(transaction => transaction.employeeId === selectedLedgerEmployee.id)
    : [], [ledger.transactions, selectedLedgerEmployee]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    employeeCreditService.refreshLedger(tenantId)
      .then(nextLedger => {
        if (cancelled) return;
        setLedger(nextLedger);
        setServerRosterLoaded(true);
      })
      .catch(error => {
        if (cancelled) return;
        setLedger(employeeCreditService.getLedger(tenantId));
        setLoadError(error instanceof Error ? error.message : 'No se pudo actualizar el registro.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, tenantId, initialView]);

  if (!isOpen) return null;

  const refresh = async () => {
    setRefreshing(true);
    setLoadError('');
    try {
      const nextLedger = await employeeCreditService.refreshLedger(tenantId);
      setLedger(nextLedger);
      setServerRosterLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo actualizar el registro.');
    } finally {
      setRefreshing(false);
    }
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedLedgerEmployee || savingPayment) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedBalance) {
      setPaymentError('Ingresa un monto válido que no supere el saldo pendiente.');
      return;
    }
    const attempt = paymentAttempt && paymentAttempt.employeeId === selectedLedgerEmployee.id && paymentAttempt.amount === amount
      ? paymentAttempt
      : {
          employeeId: selectedLedgerEmployee.id,
          amount,
          key: `payment:${tenantId}:${selectedLedgerEmployee.id}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`
        };
    setPaymentAttempt(attempt);
    setSavingPayment(true);
    setPaymentError('');
    try {
      await onRecordPayment(selectedLedgerEmployee, amount, attempt.key);
      setLedger(employeeCreditService.getLedger(tenantId));
      setPaymentAmount('');
      setPaymentAttempt(null);
      setSelectedLedgerEmployee(null);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'No se pudo registrar el abono.');
    } finally {
      setSavingPayment(false);
    }
  };

  const selectEmployee = (employee: EmployeeCreditEmployee) => {
    onSelectEmployee({ id: employee.id, name: employee.name });
    setSearch('');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-stone-950/70 p-3 backdrop-blur-sm sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="executive-order-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
      >
        <header className="flex items-center justify-between gap-3 bg-stone-900 px-5 py-4 text-white sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#a9b994]/30 bg-[#a9b994]/15 text-[#cbd8bd]">
              {activeView === 'ledger' ? <History className="h-5 w-5" /> : <BriefcaseBusiness className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h2 id="executive-order-title" className="truncate text-base font-black sm:text-lg">
                {activeView === 'ledger' ? 'Registro de consumo' : 'Comanda Ejecutiva'}
              </h2>
              <p className="mt-0.5 text-[11px] text-stone-300">
                {activeView === 'ledger' ? 'Saldos y movimientos de crédito del equipo' : 'Selecciona al colaborador al que se asignará la cuenta'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-stone-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a9b994]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <nav className="grid grid-cols-2 gap-2 border-b border-stone-200 bg-stone-50 p-3 sm:px-5" aria-label="Secciones de crédito">
          <button type="button" onClick={() => { setActiveView('new-order'); setSearch(''); setSelectedLedgerEmployee(null); }} aria-current={activeView === 'new-order' ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition ${activeView === 'new-order' ? 'bg-[#588157] text-white shadow-sm' : 'text-stone-600 hover:bg-white hover:text-stone-900'}`}>
            <BriefcaseBusiness className="h-4 w-4" /> Nueva comanda
          </button>
          <button type="button" onClick={() => { setActiveView('ledger'); setSearch(''); setSelectedLedgerEmployee(null); }} aria-current={activeView === 'ledger' ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition ${activeView === 'ledger' ? 'bg-[#588157] text-white shadow-sm' : 'text-stone-600 hover:bg-white hover:text-stone-900'}`}>
            <History className="h-4 w-4" /> Registro de consumo
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loadError && (
            <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900">
              <span>{loadError}. {ledger.transactions.length > 0 ? 'Se muestran los últimos datos guardados en este equipo.' : 'Se mostrarán datos disponibles en este equipo.'}</span>
              <button type="button" onClick={() => void refresh()} className="shrink-0 font-bold underline underline-offset-2">Reintentar</button>
            </div>
          )}

          {activeView === 'new-order' ? (
            <div className="space-y-4">
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <label className="sr-only" htmlFor="executive-employee-search">Buscar colaborador por nombre</label>
                <input id="executive-employee-search" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar colaborador por nombre"
                  className="min-h-12 w-full rounded-2xl border border-stone-200 bg-stone-50 pl-10 pr-4 text-sm text-stone-900 outline-none transition focus:border-[#588157] focus:ring-4 focus:ring-[#588157]/15" />
              </div>
              {loading && selectionEmployees.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando colaboradores…</div>
              ) : searchedEmployees.length > 0 ? (
                <div className="space-y-2">
                  {searchedEmployees.map(employee => (
                    <button key={employee.id} type="button" onClick={() => selectEmployee(employee)}
                      className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-[#588157] hover:bg-[#a9b994]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition group-hover:bg-[#588157]/15 group-hover:text-[#456746]"><UserRound className="h-4 w-4" /></span>
                        <span className="truncate text-sm font-bold text-stone-900">{employee.name}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-[#588157]" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center">
                  <UserRound className="mx-auto mb-2 h-6 w-6 text-stone-300" />
                  <p className="text-sm font-semibold text-stone-600">{search ? 'No hay colaboradores con ese nombre.' : 'No hay colaboradores activos disponibles.'}</p>
                  {!search && <p className="mt-1 text-xs text-stone-400">Agrega o activa colaboradores en Equipo y Personal.</p>}
                </div>
              )}
              <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-[11px] leading-relaxed text-emerald-900">
                <Check className="mt-0.5 h-4 w-4 shrink-0" /> El consumo se guardará como crédito del colaborador y no como un pago recibido en caja.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedLedgerEmployee ? (
                <>
                  <button type="button" onClick={() => { setSelectedLedgerEmployee(null); setPaymentError(''); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-xs font-bold text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                    <ArrowLeft className="h-4 w-4" /> Todos los colaboradores
                  </button>
                  <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-stone-500">Saldo pendiente de</p>
                        <h3 className="mt-1 text-lg font-black text-stone-900">{selectedLedgerEmployee.name}</h3>
                      </div>
                      <div className="rounded-2xl bg-amber-50 px-4 py-2 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Debe</p>
                        <p className="text-lg font-black tabular-nums text-amber-900">{currencyFormatter.format(Math.max(0, selectedBalance))}</p>
                      </div>
                    </div>
                    {selectedBalance > 0 && (
                      <div className="mt-4 border-t border-stone-100 pt-4">
                        {!isOnline && <p className="mb-2 text-xs text-amber-800">Conecta el dispositivo para registrar un abono.</p>}
                        <form onSubmit={submitPayment} className="flex flex-col gap-2 sm:flex-row">
                          <label className="sr-only" htmlFor="employee-credit-payment-amount">Monto del abono</label>
                          <input id="employee-credit-payment-amount" type="number" min="0.01" step="0.01" max={selectedBalance} inputMode="decimal" value={paymentAmount}
      onChange={event => { setPaymentAmount(event.target.value); setPaymentError(''); setPaymentAttempt(null); }} placeholder="Monto del abono"
                            className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 px-3 text-sm outline-none focus:border-[#588157] focus:ring-4 focus:ring-[#588157]/10" />
                          <button type="submit" disabled={!isOnline || savingPayment || !paymentAmount}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#588157] px-4 text-xs font-bold text-white transition hover:bg-[#466c45] disabled:cursor-not-allowed disabled:opacity-50">
                            {savingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                            Registrar abono
                          </button>
                        </form>
                        {paymentError && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{paymentError}</p>}
                        <p className="mt-2 text-[10px] leading-relaxed text-stone-500">El abono también se registra en el turno de caja abierto.</p>
                      </div>
                    )}
                  </section>
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-xs font-black uppercase tracking-wide text-stone-600">Movimientos</h4>
                      {ledger.hasMoreTransactions && <span className="text-[10px] text-stone-400">Mostrando movimientos recientes</span>}
                    </div>
                    {employeeTransactions.length > 0 ? (
                      <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
                        {employeeTransactions.map(transaction => (
                          <div key={transaction.id} className="flex items-center justify-between gap-3 px-3.5 py-3 sm:px-4">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${transaction.type === 'CHARGE' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {transaction.type === 'CHARGE' ? <CircleDollarSign className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-bold text-stone-800">{transactionTitle(transaction)}</span>
                                <span className="mt-0.5 block text-[10px] text-stone-500">{formatDate(transaction.createdAt)}</span>
                                {transaction.pending && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">Pendiente de sincronización</span>}
                              </span>
                            </div>
                            <span className={`shrink-0 text-sm font-black tabular-nums ${transaction.type === 'CHARGE' ? 'text-amber-800' : 'text-emerald-800'}`}>
                              {transaction.type === 'CHARGE' ? '+' : '−'}{currencyFormatter.format(transaction.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-xs text-stone-500">Todavía no hay movimientos registrados.</p>}
                  </section>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3.5 sm:p-4">
                      <div className="flex items-center gap-2 text-emerald-800"><Wallet className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-wide">Total pendiente</span></div>
                      <p className="mt-2 text-xl font-black tabular-nums text-emerald-950 sm:text-2xl">{currencyFormatter.format(Math.max(0, totalDebt))}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5 sm:p-4">
                      <div className="flex items-center gap-2 text-stone-600"><UserRound className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-wide">Colaboradores</span></div>
                      <p className="mt-2 text-xl font-black tabular-nums text-stone-900 sm:text-2xl">{ledgerEmployees.length}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <Search aria-hidden="true" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                      <label className="sr-only" htmlFor="employee-credit-ledger-search">Buscar en el registro por nombre</label>
                      <input id="employee-credit-ledger-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre"
                        className="min-h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#588157] focus:ring-4 focus:ring-[#588157]/10" />
                    </div>
                    <button type="button" onClick={() => void refresh()} disabled={refreshing}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-bold text-stone-700 transition hover:bg-stone-100 disabled:opacity-50">
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualizar
                    </button>
                  </div>
                  {loading && ledgerEmployees.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando registro…</div>
                  ) : visibleLedgerEmployees.length > 0 ? (
                    <div className="space-y-2">
                      {visibleLedgerEmployees.map(employee => {
                        const balance = ledger.accounts.find(account => account.employeeId === employee.id)?.balance || 0;
                        const transactions = ledger.transactions.filter(item => item.employeeId === employee.id).length;
                        return (
                          <button key={employee.id} type="button" onClick={() => { setSelectedLedgerEmployee(employee); setPaymentAmount(''); setPaymentError(''); }}
                            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-[#588157] hover:bg-[#a9b994]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#588157]">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-stone-900">{employee.name}</span>
                              <span className="mt-0.5 block text-[10px] text-stone-500">{transactions} {transactions === 1 ? 'movimiento' : 'movimientos'}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className={`text-sm font-black tabular-nums ${balance > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>{currencyFormatter.format(Math.max(0, balance))}</span>
                              <ChevronRight className="h-4 w-4 text-stone-400" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center">
                      <History className="mx-auto mb-2 h-6 w-6 text-stone-300" />
                      <p className="text-sm font-semibold text-stone-600">{search ? 'No hay resultados para esa búsqueda.' : 'Aún no hay consumos de colaboradores.'}</p>
                    </div>
                  )}
                  {ledger.hasMoreTransactions && <p className="text-center text-[10px] text-stone-400">El historial muestra los 500 movimientos más recientes.</p>}
                  {loadError && ledger.transactions.length === 0 && <p className="text-center text-[10px] text-stone-400">Conéctate para consultar el registro centralizado y sus saldos.</p>}
                </>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-stone-100 bg-stone-50 px-4 py-3 text-[10px] text-stone-500 sm:px-5">
          <span className="flex min-w-0 items-center gap-1.5"><History className="h-3.5 w-3.5 shrink-0" /> Los movimientos quedan asociados a este restaurante.</span>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg px-3 py-2 font-bold text-stone-600 hover:bg-stone-200">Cerrar</button>
        </footer>
      </section>
    </div>
  );
};
