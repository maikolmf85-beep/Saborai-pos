import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, Check, Clock3, Edit3, LoaderCircle, MapPin,
  Plus, RefreshCw, Search, Users, Utensils, Wifi, WifiOff, X
} from 'lucide-react';
import type { Table, TenantInfo, UserProfile } from '../types';
import {
  createTableReservation, hasPendingTableReservationSync, loadTableReservations, subscribeToTableReservations,
  updateTableReservation
} from '../services/tableReservationService';
import type {
  TableReservation, TableReservationInput, TableReservationStatus
} from '../types/tableReservation';

export interface TableReservationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: TenantInfo;
  tables: Table[];
  onOpenTable: (table: Table) => void;
  canOpenTable?: (table: Table) => boolean;
  currentUser?: UserProfile | null;
}

type StatusFilter = 'ALL' | TableReservationStatus;
type TerminalAction = 'SEATED' | 'CANCELLED' | 'NO_SHOW';

const STATUS_LABELS: Record<TableReservationStatus, string> = {
  CONFIRMED: 'Confirmada',
  ARRIVED: 'Llegó',
  SEATED: 'Sentada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No se presentó'
};

const STATUS_STYLES: Record<TableReservationStatus, string> = {
  CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
  ARRIVED: 'bg-amber-50 text-amber-800 border-amber-200',
  SEATED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CANCELLED: 'bg-stone-100 text-stone-600 border-stone-200',
  NO_SHOW: 'bg-rose-50 text-rose-700 border-rose-200'
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'CONFIRMED', label: 'Confirmadas' },
  { value: 'ARRIVED', label: 'Llegaron' },
  { value: 'SEATED', label: 'Sentadas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'NO_SHOW', label: 'No se presentó' }
];

interface ReservationForm {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  zone: string;
  tableId: string;
  reservedAtLocal: string;
  durationMinutes: string;
  partySize: string;
  notes: string;
}

interface Confirmation {
  reservation: TableReservation;
  action: TerminalAction;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultLocalReservationTime(): string {
  const now = new Date();
  now.setMinutes(Math.ceil((now.getMinutes() + 1) / 15) * 15, 0, 0);
  return toLocalInputValue(now.toISOString());
}

function displayTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'Hora no disponible'
    : new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function displayDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(date);
}

function makeBlankForm(table?: Table): ReservationForm {
  return {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    zone: table?.zone || '',
    tableId: table?.id || '',
    reservedAtLocal: defaultLocalReservationTime(),
    durationMinutes: '90',
    partySize: '2',
    notes: ''
  };
}

function hasTimeConflict(
  reservations: TableReservation[],
  tableId: string,
  reservedAtIso: string,
  durationMinutes: number,
  ignoreId?: string
): TableReservation | undefined {
  const start = new Date(reservedAtIso).getTime();
  const end = start + durationMinutes * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return reservations.find(item => {
    if (item.id === ignoreId || item.tableId !== tableId || !['CONFIRMED', 'ARRIVED', 'SEATED'].includes(item.status)) return false;
    const otherStart = new Date(item.reservedAt).getTime();
    const otherEnd = otherStart + item.durationMinutes * 60_000;
    return Number.isFinite(otherStart) && start < otherEnd && otherStart < end;
  });
}

export const TableReservationsModal: React.FC<TableReservationsModalProps> = ({
  isOpen,
  onClose,
  tenant,
  tables,
  onOpenTable,
  canOpenTable,
  currentUser
}) => {
  const [reservations, setReservations] = useState<TableReservation[]>([]);
  const [selectedDate, setSelectedDate] = useState(localDateKey(new Date()));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TableReservation | null>(null);
  const [form, setForm] = useState<ReservationForm>(() => makeBlankForm());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' || navigator.onLine);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmCapacity, setConfirmCapacity] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await loadTableReservations(tenant.id);
      setReservations(result);
    } catch {
      setMessage('No fue posible actualizar la agenda. Se muestran los datos guardados en este dispositivo.');
    } finally {
      setIsLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void loadTableReservations(tenant.id).then(result => {
      if (!active) return;
      setReservations(result);
      setIsLoading(false);
    }).catch(() => {
      if (!active) return;
      setMessage('No fue posible actualizar la agenda. Se muestran los datos guardados en este dispositivo.');
      setIsLoading(false);
    });
    const unsubscribe = subscribeToTableReservations(tenant.id, () => { void refresh(); });
    const handleOnline = () => {
      setIsOnline(true);
      void refresh();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOpen, tenant.id, refresh]);

  const zones = useMemo(() => {
    const candidates = [...(tenant.zones || []), ...tables.map(table => table.zone).filter(Boolean)];
    return [...new Set(candidates)];
  }, [tenant.zones, tables]);

  const zoneTables = useMemo(
    () => tables.filter(table => !form.zone || table.zone === form.zone),
    [tables, form.zone]
  );
  const selectedTable = tables.find(table => table.id === form.tableId);
  const reservedAtIso = form.reservedAtLocal && !Number.isNaN(new Date(form.reservedAtLocal).getTime())
    ? new Date(form.reservedAtLocal).toISOString()
    : '';
  const durationNumber = Number(form.durationMinutes);
  const partyNumber = Number(form.partySize);
  const conflict = selectedTable && reservedAtIso && durationNumber > 0
    ? hasTimeConflict(reservations, selectedTable.id, reservedAtIso, durationNumber, editing?.id)
    : undefined;
  const exceedsCapacity = Boolean(selectedTable && partyNumber > selectedTable.seats);

  const dayReservations = useMemo(() => reservations
    .filter(item => localDateKey(new Date(item.reservedAt)) === selectedDate)
    .filter(item => statusFilter === 'ALL' || item.status === statusFilter)
    .filter(item => {
      const needle = search.trim().toLocaleLowerCase();
      if (!needle) return true;
      return [item.customerName, item.customerPhone, item.tableName, item.zone]
        .some(value => value.toLocaleLowerCase().includes(needle));
    })
    .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt)),
  [reservations, selectedDate, statusFilter, search]);

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setForm(makeBlankForm());
    setConfirmCapacity(false);
  };

  const startNew = (table?: Table) => {
    setEditing(null);
    setForm(makeBlankForm(table));
    setConfirmCapacity(false);
    setMessage('');
    setIsFormOpen(true);
  };

  const startEdit = (reservation: TableReservation) => {
    if (!['CONFIRMED', 'ARRIVED'].includes(reservation.status)) return;
    setEditing(reservation);
    setForm({
      customerName: reservation.customerName,
      customerPhone: reservation.customerPhone,
      customerEmail: reservation.customerEmail || '',
      zone: reservation.zone,
      tableId: reservation.tableId,
      reservedAtLocal: toLocalInputValue(reservation.reservedAt),
      durationMinutes: String(reservation.durationMinutes),
      partySize: String(reservation.partySize),
      notes: reservation.notes || ''
    });
    setConfirmCapacity(false);
    setMessage('');
    setIsFormOpen(true);
  };

  const saveReservation = async (ignoreCapacityWarning = false) => {
    setMessage('');
    if (!form.customerName.trim()) {
      setMessage('El nombre del cliente es requerido.');
      return;
    }
    if (!form.customerPhone.trim()) {
      setMessage('El teléfono del cliente es requerido.');
      return;
    }
    if (!selectedTable) {
      setMessage('Selecciona una mesa para esta reserva.');
      return;
    }
    if (!reservedAtIso || durationNumber < 15 || durationNumber > 720 || !Number.isInteger(durationNumber)) {
      setMessage('Indica una fecha válida y una duración entre 15 y 720 minutos.');
      return;
    }
    if (!Number.isInteger(partyNumber) || partyNumber < 1 || partyNumber > 100) {
      setMessage('El grupo debe tener entre 1 y 100 personas.');
      return;
    }
    if (conflict) {
      setMessage(`Conflicto de horario: ${conflict.customerName} ya tiene ${selectedTable.name} de ${displayTime(conflict.reservedAt)} a ${displayTime(new Date(new Date(conflict.reservedAt).getTime() + conflict.durationMinutes * 60_000).toISOString())}. Elige otra mesa u horario.`);
      return;
    }
    if (exceedsCapacity && !ignoreCapacityWarning) {
      setConfirmCapacity(true);
      return;
    }

    const input: TableReservationInput = {
      tableId: selectedTable.id,
      tableName: selectedTable.name || `Mesa ${selectedTable.number}`,
      zone: selectedTable.zone || form.zone || 'General',
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      customerEmail: form.customerEmail.trim() || undefined,
      reservedAt: reservedAtIso,
      durationMinutes: durationNumber,
      partySize: partyNumber,
      notes: form.notes.trim(),
      status: editing?.status || 'CONFIRMED',
      arrivedAt: editing?.arrivedAt,
      seatedAt: editing?.seatedAt
    };
    setIsSaving(true);
    try {
      const updated = editing
        ? await updateTableReservation(tenant.id, { ...editing, ...input })
        : await createTableReservation(tenant.id, input);
      setReservations(previous => [...previous.filter(item => item.id !== updated.id), updated]
        .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt)));
      setMessage(hasPendingTableReservationSync(tenant.id)
        ? 'Reserva guardada en este dispositivo; queda pendiente de sincronización con la base central.'
        : 'Reserva guardada y sincronizada con la base central.');
      closeForm();
    } catch {
      setMessage('No se pudo guardar la reserva. Inténtalo de nuevo.');
    } finally {
      setIsSaving(false);
    }
  };

  const applyAction = async (reservation: TableReservation, action: TerminalAction) => {
    const allowed = action === 'SEATED'
      ? reservation.status === 'ARRIVED'
      : action === 'CANCELLED'
        ? reservation.status === 'CONFIRMED' || reservation.status === 'ARRIVED'
        : reservation.status === 'CONFIRMED';
    if (!allowed) return;

    const seatingTable = action === 'SEATED'
      ? tables.find(item => item.id === reservation.tableId)
      : undefined;
    if (action === 'SEATED') {
      if (!seatingTable) {
        setMessage('La mesa ya no está disponible en el plano. No se cambió el estado de la reserva.');
        return;
      }
      if (canOpenTable && !canOpenTable(seatingTable)) return;
    }

    const timestamp = new Date().toISOString();
    const updated: TableReservation = {
      ...reservation,
      status: action,
      ...(action === 'SEATED' ? { seatedAt: timestamp } : {}),
      ...(action === 'CANCELLED' ? { arrivedAt: reservation.arrivedAt || null } : {}),
      ...(action === 'NO_SHOW' ? { arrivedAt: reservation.arrivedAt || null } : {})
    };
    try {
      const saved = await updateTableReservation(tenant.id, updated);
      setReservations(previous => previous.map(item => item.id === saved.id ? saved : item));
      if (action === 'SEATED') {
        onOpenTable(seatingTable!);
        onClose();
      } else if (hasPendingTableReservationSync(tenant.id)) {
        setMessage('Cambio guardado en este dispositivo; queda pendiente de sincronización.');
      }
    } catch {
      setMessage('No se pudo actualizar el estado de la reserva.');
    }
  };

  const markArrived = async (reservation: TableReservation) => {
    if (reservation.status !== 'CONFIRMED') return;
    try {
      const saved = await updateTableReservation(tenant.id, {
        ...reservation,
        status: 'ARRIVED',
        arrivedAt: new Date().toISOString()
      });
      setReservations(previous => previous.map(item => item.id === saved.id ? saved : item));
      if (hasPendingTableReservationSync(tenant.id)) {
        setMessage('Llegada registrada en este dispositivo; queda pendiente de sincronización.');
      }
    } catch {
      setMessage('No se pudo registrar la llegada.');
    }
  };

  const askTerminalAction = (reservation: TableReservation, action: TerminalAction) => {
    const allowed = action === 'SEATED'
      ? reservation.status === 'ARRIVED'
      : action === 'CANCELLED'
        ? reservation.status === 'CONFIRMED' || reservation.status === 'ARRIVED'
        : reservation.status === 'CONFIRMED';
    if (allowed) setConfirmation({ reservation, action });
  };

  const confirmMessage = confirmation?.action === 'SEATED'
    ? `¿Confirmas que ${confirmation.reservation.customerName} ya está sentada en ${confirmation.reservation.tableName}? Se abrirá la mesa en el mapa.`
    : confirmation?.action === 'CANCELLED'
      ? `¿Cancelar la reserva de ${confirmation.reservation.customerName}? Esta acción es terminal.`
      : `¿Marcar la reserva de ${confirmation?.reservation.customerName} como no presentada? Esta acción es terminal.`;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-stone-950/65 p-2 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-reservations-title"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-[#faf9f6] shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7eee2] text-[#588157]"><CalendarDays size={22} /></div>
            <div>
              <h2 id="table-reservations-title" className="text-lg font-black text-stone-900">Reservas de mesas</h2>
              <p className="text-xs text-stone-500">{tenant.name} · Agenda y atención de clientes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold sm:flex ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}{isOnline ? 'En línea' : 'Modo sin conexión'}
            </span>
            <button type="button" onClick={onClose} aria-label="Cerrar reservas" className="rounded-xl p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-900"><X size={20} /></button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_390px] lg:overflow-hidden">
          <section className="min-h-0 border-b border-stone-200 p-4 sm:p-6 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block max-w-xs text-xs font-bold text-stone-600">
                Agenda del día
                <input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 outline-none focus:border-[#7d9b75] focus:ring-2 focus:ring-[#a9b994]/30" />
              </label>
              <div className="flex gap-2">
                <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar cliente o mesa" className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-[#7d9b75]" />
                </label>
                <button type="button" onClick={() => void refresh()} disabled={isLoading} title="Actualizar agenda" className="rounded-xl border border-stone-200 bg-white p-2.5 text-stone-600 hover:bg-stone-100 disabled:opacity-50"><RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} /></button>
                <button type="button" onClick={() => startNew()} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#588157] px-3.5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-[#476946]"><Plus size={16} /> Nueva</button>
              </div>
            </div>

            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {FILTERS.map(filter => (
                <button key={filter.value} type="button" onClick={() => setStatusFilter(filter.value)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold ${statusFilter === filter.value ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-100'}`}>
                  {filter.label}{filter.value === 'ALL' ? ` · ${reservations.filter(item => localDateKey(new Date(item.reservedAt)) === selectedDate).length}` : ''}
                </button>
              ))}
            </div>

            {message && !isFormOpen && <div role="status" className="mb-3 rounded-xl border border-[#d4dfcd] bg-[#f1f5ed] px-3 py-2.5 text-xs font-medium text-[#476946]">{message}</div>}
            {isLoading && reservations.length === 0 ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-stone-500"><LoaderCircle size={18} className="animate-spin" /> Cargando agenda…</div>
            ) : dayReservations.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/60 px-5 text-center">
                <CalendarDays size={28} className="mb-2 text-stone-300" />
                <p className="font-bold text-stone-700">No hay reservas para este día</p>
                <p className="mt-1 text-xs text-stone-500">Puedes crear una reserva o cambiar la fecha seleccionada.</p>
                <button type="button" onClick={() => startNew()} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black text-[#476946] hover:bg-[#e7eee2]"><Plus size={14} /> Crear reserva</button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {dayReservations.map(reservation => {
                  const table = tables.find(item => item.id === reservation.tableId);
                  const canEdit = reservation.status === 'CONFIRMED' || reservation.status === 'ARRIVED';
                  return (
                    <article key={reservation.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-black tracking-tight text-stone-900">{displayTime(reservation.reservedAt)}</span>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${STATUS_STYLES[reservation.status]}`}>{STATUS_LABELS[reservation.status]}</span>
                            <span className="text-[11px] text-stone-400">{displayDate(reservation.reservedAt)}</span>
                          </div>
                          <h3 className="mt-2 truncate font-extrabold text-stone-800">{reservation.customerName}</h3>
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                            <span className="inline-flex items-center gap-1"><Users size={13} /> {reservation.partySize} personas</span>
                            <span className="inline-flex items-center gap-1"><Utensils size={13} /> {reservation.tableName}</span>
                            <span className="inline-flex items-center gap-1"><MapPin size={13} /> {reservation.zone || 'General'}</span>
                            <span className="inline-flex items-center gap-1"><Clock3 size={13} /> {reservation.durationMinutes} min</span>
                          </div>
                          <div className="mt-1 text-xs text-stone-500">{reservation.customerPhone}{reservation.customerEmail ? ` · ${reservation.customerEmail}` : ''}</div>
                          {reservation.notes && <p className="mt-2 rounded-lg bg-stone-50 px-2.5 py-2 text-xs text-stone-600">{reservation.notes}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                          {canEdit && <button type="button" onClick={() => startEdit(reservation)} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-2 text-[11px] font-bold text-stone-600 hover:bg-stone-50"><Edit3 size={13} /> Editar</button>}
                          {reservation.status === 'CONFIRMED' && <button type="button" onClick={() => void markArrived(reservation)} className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-2 text-[11px] font-black text-amber-900 hover:bg-amber-200"><Check size={13} /> Llegó</button>}
                          {reservation.status === 'ARRIVED' && <button type="button" onClick={() => askTerminalAction(reservation, 'SEATED')} className="inline-flex items-center gap-1 rounded-lg bg-[#588157] px-2.5 py-2 text-[11px] font-black text-white hover:bg-[#476946]"><Utensils size={13} /> Sentar y abrir</button>}
                          {(reservation.status === 'CONFIRMED' || reservation.status === 'ARRIVED') && <button type="button" onClick={() => askTerminalAction(reservation, 'CANCELLED')} className="rounded-lg border border-rose-200 px-2.5 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-50">Cancelar</button>}
                          {reservation.status === 'CONFIRMED' && <button type="button" onClick={() => askTerminalAction(reservation, 'NO_SHOW')} className="rounded-lg border border-stone-200 px-2.5 py-2 text-[11px] font-bold text-stone-600 hover:bg-stone-50">No se presentó</button>}
                          {reservation.status === 'ARRIVED' && table && <button type="button" onClick={() => { if (canOpenTable && !canOpenTable(table)) return; onOpenTable(table); }} className="rounded-lg border border-stone-200 px-2.5 py-2 text-[11px] font-bold text-stone-600 hover:bg-stone-50">Abrir mesa</button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="min-h-0 p-4 sm:p-6 lg:overflow-y-auto">
            {!isFormOpen ? (
              <div className="flex h-full min-h-72 flex-col justify-between rounded-2xl border border-stone-200 bg-white p-5">
                <div>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7eee2] text-[#588157]"><Users size={20} /></div>
                  <h3 className="font-black text-stone-900">Gestión de reservas</h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">Agenda por fecha, confirma llegadas y abre la mesa cuando el grupo esté listo.</p>
                  <div className="mt-5 space-y-2.5 border-t border-stone-100 pt-4 text-xs text-stone-600">
                    <div className="flex justify-between"><span>Reservas del día</span><strong>{reservations.filter(item => localDateKey(new Date(item.reservedAt)) === selectedDate).length}</strong></div>
                    <div className="flex justify-between"><span>Confirmadas</span><strong>{reservations.filter(item => localDateKey(new Date(item.reservedAt)) === selectedDate && item.status === 'CONFIRMED').length}</strong></div>
                    <div className="flex justify-between"><span>Mesas configuradas</span><strong>{tables.length}</strong></div>
                  </div>
                </div>
                <button type="button" onClick={() => startNew()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-black text-white hover:bg-stone-800"><Plus size={17} /> Crear reserva</button>
              </div>
            ) : (
              <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3.5">
                  <div>
                    <h3 className="font-black text-stone-900">{editing ? 'Editar reserva' : 'Nueva reserva'}</h3>
                    <p className="mt-0.5 text-[11px] text-stone-500">Los campos con * son obligatorios</p>
                  </div>
                  <button type="button" onClick={closeForm} aria-label="Cerrar formulario" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100"><X size={17} /></button>
                </div>
                <form className="space-y-3.5 p-4" onSubmit={event => { event.preventDefault(); void saveReservation(); }}>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="col-span-2 text-xs font-bold text-stone-600">Nombre del cliente *
                      <input autoFocus value={form.customerName} onChange={event => setForm(prev => ({ ...prev, customerName: event.target.value }))} maxLength={120} required placeholder="Nombre y apellido" className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75] focus:ring-2 focus:ring-[#a9b994]/25" />
                    </label>
                    <label className="text-xs font-bold text-stone-600">Teléfono *
                      <input value={form.customerPhone} onChange={event => setForm(prev => ({ ...prev, customerPhone: event.target.value }))} maxLength={40} required type="tel" placeholder="8888-8888" className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]" />
                    </label>
                    <label className="text-xs font-bold text-stone-600">Email
                      <input value={form.customerEmail} onChange={event => setForm(prev => ({ ...prev, customerEmail: event.target.value }))} maxLength={254} type="email" placeholder="cliente@email.com" className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="text-xs font-bold text-stone-600">Salón
                      <select value={form.zone} onChange={event => setForm(prev => ({ ...prev, zone: event.target.value, tableId: '' }))} className="mt-1 block w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]">
                        <option value="">Todos</option>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-stone-600">Mesa *
                      <select value={form.tableId} onChange={event => setForm(prev => ({ ...prev, tableId: event.target.value }))} required className="mt-1 block w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]">
                        <option value="">Seleccionar mesa</option>
                        {zoneTables.map(table => <option key={table.id} value={table.id}>{table.name || `Mesa ${table.number}`} · {table.seats} puestos</option>)}
                        {editing && !zoneTables.some(table => table.id === editing.tableId) && <option value={editing.tableId}>{editing.tableName} (mesa previa)</option>}
                      </select>
                    </label>
                  </div>
                  {selectedTable && <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-600"><span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {selectedTable.zone || form.zone || 'General'} · capacidad {selectedTable.seats}</span><span>{form.partySize || 0} personas</span></div>}

                  <label className="block text-xs font-bold text-stone-600">Fecha y hora local *
                    <input type="datetime-local" value={form.reservedAtLocal} onChange={event => setForm(prev => ({ ...prev, reservedAtLocal: event.target.value }))} required className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]" />
                    <span className="mt-1 block text-[10px] font-normal text-stone-400">La hora del dispositivo se guardará con zona horaria en ISO.</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="text-xs font-bold text-stone-600">Duración *
                      <select value={form.durationMinutes} onChange={event => setForm(prev => ({ ...prev, durationMinutes: event.target.value }))} className="mt-1 block w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]">
                        {[30, 45, 60, 75, 90, 105, 120, 150, 180, 240].map(minutes => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-stone-600">Personas *
                      <input type="number" min={1} max={100} step={1} required value={form.partySize} onChange={event => setForm(prev => ({ ...prev, partySize: event.target.value }))} className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]" />
                    </label>
                  </div>

                  {conflict && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span><strong>Conflicto de horario.</strong> {conflict.customerName} ya reservó {conflict.tableName} a las {displayTime(conflict.reservedAt)}. Elige otra mesa o ajusta la hora.</span></div>}
                  {exceedsCapacity && selectedTable && <div role="status" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>El grupo excede la capacidad de {selectedTable.name} ({selectedTable.seats} puestos). Puedes elegir otra mesa o confirmar para guardar de todos modos.</span></div>}
                  <label className="block text-xs font-bold text-stone-600">Notas
                    <textarea rows={2} maxLength={1000} value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} placeholder="Preferencias, ocasión especial…" className="mt-1 block w-full resize-y rounded-xl border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-900 outline-none focus:border-[#7d9b75]" />
                  </label>
                  {message && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</p>}
                  <div className="flex gap-2 border-t border-stone-100 pt-3">
                    <button type="button" onClick={closeForm} className="flex-1 rounded-xl border border-stone-200 px-3 py-2.5 text-xs font-bold text-stone-600 hover:bg-stone-50">Cerrar</button>
                    <button type="submit" disabled={isSaving || Boolean(conflict)} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#588157] px-3 py-2.5 text-xs font-black text-white hover:bg-[#476946] disabled:cursor-not-allowed disabled:opacity-50">
                      {isSaving ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}{isSaving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear reserva'}
                    </button>
                  </div>
                  {confirmCapacity && <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[9100] flex items-center justify-center bg-stone-950/60 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
                      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={21} /><div><h4 className="font-black text-stone-900">Capacidad excedida</h4><p className="mt-1 text-sm text-stone-600">El grupo tiene {partyNumber} personas y la mesa admite {selectedTable?.seats}. ¿Guardar esta reserva de todos modos?</p></div></div>
                      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmCapacity(false)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600">Elegir otra mesa</button><button type="button" onClick={() => { setConfirmCapacity(false); void saveReservation(true); }} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700">Guardar de todos modos</button></div>
                    </div>
                  </div>}
                </form>
              </div>
            )}
          </aside>
        </div>

        <footer className="flex items-center justify-between border-t border-stone-200 bg-white px-5 py-2.5 text-[10px] text-stone-400 sm:px-7">
          <span>Los cambios se sincronizan cuando hay conexión disponible.</span>
          <span>{currentUser?.name ? `Atiende ${currentUser.name}` : 'SaborAI · Reservas'}</span>
        </footer>
      </div>

      {confirmation && <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[9200] flex items-center justify-center bg-stone-950/65 p-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={21} /><div><h3 className="font-black text-stone-900">{confirmation.action === 'SEATED' ? 'Confirmar mesa lista' : confirmation.action === 'CANCELLED' ? 'Cancelar reserva' : 'Registrar ausencia'}</h3><p className="mt-1 text-sm leading-relaxed text-stone-600">{confirmMessage}</p></div></div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmation(null)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">Volver</button><button type="button" onClick={() => { const pending = confirmation; setConfirmation(null); void applyAction(pending.reservation, pending.action); }} className={`rounded-lg px-3 py-2 text-xs font-black text-white ${confirmation.action === 'CANCELLED' || confirmation.action === 'NO_SHOW' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#588157] hover:bg-[#476946]'}`}>{confirmation.action === 'SEATED' ? 'Sí, sentar y abrir' : confirmation.action === 'CANCELLED' ? 'Sí, cancelar' : 'Sí, no se presentó'}</button></div>
        </div>
      </div>}
    </div>
  );
};
