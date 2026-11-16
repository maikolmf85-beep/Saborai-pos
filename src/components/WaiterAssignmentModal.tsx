import React from 'react';
import { ChefHat, UtensilsCrossed, X } from 'lucide-react';
import type { Table, UserProfile } from '../types';
import { getAssignableTableWaiters } from '../services/waiterTableAssignment';

interface WaiterAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table | null;
  staffList: UserProfile[];
  currentUser?: UserProfile | null;
  onSelectWaiter: (staff: UserProfile) => void;
}

export const WaiterAssignmentModal: React.FC<WaiterAssignmentModalProps> = ({
  isOpen,
  onClose,
  table,
  staffList,
  currentUser,
  onSelectWaiter
}) => {
  if (!isOpen || !table) return null;

  const eligibleWaiters = getAssignableTableWaiters(staffList, currentUser);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-xs">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                <span>¿Quién atiende esta mesa?</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-stone-200 text-stone-700 font-semibold">
                  {table.name}
                </span>
              </h3>
              <p className="text-[11px] text-stone-500">Seleccioná al salonero para iniciar la comanda.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar selección de salonero"
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {eligibleWaiters.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {eligibleWaiters.map((staff) => (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => onSelectWaiter(staff)}
                  className="p-3 rounded-2xl border border-stone-200 bg-stone-50/80 hover:bg-white hover:border-stone-900 hover:ring-2 hover:ring-stone-900/10 transition-all flex items-center gap-3 text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-stone-900 text-[#a9b994] flex items-center justify-center shrink-0">
                    <ChefHat className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 text-sm font-bold text-stone-900 truncate">{staff.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No hay saloneros activos disponibles para asignar a esta mesa.
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-stone-100 bg-stone-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-stone-200 text-stone-700 rounded-xl text-xs font-semibold hover:bg-stone-100 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
