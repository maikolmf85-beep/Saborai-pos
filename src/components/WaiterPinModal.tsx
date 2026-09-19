import React, { useState, useEffect } from 'react';
import { 
  X, 
  KeyRound, 
  ShieldCheck, 
  ChefHat, 
  Zap, 
  Receipt, 
  Delete, 
  Check, 
  AlertCircle,
  User,
  UtensilsCrossed
} from 'lucide-react';
import { UserProfile, Table, UserRole } from '../types';

interface WaiterPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table | null;
  staffList: UserProfile[];
  onConfirm: (staff: UserProfile) => void;
}

export const WaiterPinModal: React.FC<WaiterPinModalProps> = ({
  isOpen,
  onClose,
  table,
  staffList,
  onConfirm
}) => {
  // Filter eligible staff (Saloneros, Salonero con Caja, Admins, etc.)
  const eligibleStaff = staffList.filter(s => s.active !== false);

  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(eligibleStaff[0] || null);
  const [pin, setPin] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isErrorShake, setIsErrorShake] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setErrorMessage(null);
      setIsErrorShake(false);
      if (eligibleStaff.length > 0 && !selectedStaff) {
        setSelectedStaff(eligibleStaff[0]);
      }
    }
  }, [isOpen]);

  // Physical keyboard listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigitClick(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, selectedStaff]);

  if (!isOpen || !table) return null;

  const handleDigitClick = (digit: string) => {
    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMessage(null);

      // Auto submit on 4th digit
      if (nextPin.length === 4) {
        validatePin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleClear = () => {
    setPin('');
    setErrorMessage(null);
  };

  const validatePin = (inputPin: string) => {
    if (!selectedStaff) {
      setErrorMessage('Por favor selecciona un salonero');
      return;
    }

    const correctPin = selectedStaff.pin || '1234';

    if (inputPin === correctPin) {
      onConfirm(selectedStaff);
      onClose();
    } else {
      setErrorMessage('PIN incorrecto. Intenta de nuevo.');
      setIsErrorShake(true);
      setTimeout(() => setIsErrorShake(false), 500);
      setPin('');
    }
  };

  const handleSubmit = () => {
    if (pin.length === 4) {
      validatePin(pin);
    } else {
      setErrorMessage('Ingresa los 4 dígitos del PIN.');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'SALONERO':
      case 'WAITER':
        return { label: 'Salonero', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: ChefHat };
      case 'SALONERO_CAJA':
        return { label: 'Salonero c/ Caja', color: 'bg-purple-50 text-purple-800 border-purple-200', icon: Zap };
      case 'CAJERO':
        return { label: 'Cajero', color: 'bg-amber-50 text-amber-800 border-amber-200', icon: Receipt };
      case 'ADMIN':
      default:
        return { label: 'Admin', color: 'bg-blue-50 text-blue-800 border-blue-200', icon: ShieldCheck };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-lg overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-xs">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                <span>Asignar Salonero Encargado</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-stone-200 text-stone-700 font-semibold">
                  {table.name}
                </span>
              </h3>
              <p className="text-[11px] text-stone-500">
                Selecciona al salonero responsable e ingresa su PIN para abrir la comanda.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          
          {/* Step 1: Select Waiter */}
          <div>
            <label className="block text-[11px] font-bold text-stone-600 uppercase mb-2">
              1. Selecciona el Salonero en Turno:
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
              {eligibleStaff.map((staff) => {
                const isSelected = selectedStaff?.id === staff.id;
                const roleBadge = getRoleBadge(staff.role);
                const Icon = roleBadge.icon;

                return (
                  <button
                    key={staff.id}
                    type="button"
                    onClick={() => {
                      setSelectedStaff(staff);
                      setPin('');
                      setErrorMessage(null);
                    }}
                    className={`p-2.5 rounded-2xl border text-left transition-all flex items-center gap-2.5 ${
                      isSelected
                        ? 'bg-white border-stone-900 ring-2 ring-stone-900/10 shadow-xs'
                        : 'bg-stone-50/80 border-stone-200 hover:bg-white hover:border-stone-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-stone-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {staff.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-stone-900 truncate">
                        {staff.name}
                      </div>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded-md border mt-0.5 ${roleBadge.color}`}>
                        <Icon className="w-2.5 h-2.5" />
                        <span>{roleBadge.label}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: PIN Input & Keypad */}
          <div className="bg-stone-50/80 rounded-2xl p-4 border border-stone-200/80 flex flex-col items-center space-y-3">
            <div className="text-center">
              <span className="text-[11px] font-bold text-stone-700 uppercase flex items-center justify-center gap-1">
                <KeyRound className="w-3.5 h-3.5 text-stone-500" />
                2. Ingresa el PIN de {selectedStaff?.name.split(' ')[0] || 'Salonero'}
              </span>
              <span className="text-[10px] text-stone-400 block mt-0.5">
                PIN de 4 dígitos configurado (prueba con {selectedStaff?.pin || '1234'})
              </span>
            </div>

            {/* 4-digit PIN circles */}
            <div className={`flex items-center justify-center gap-3 my-1 transition-transform ${isErrorShake ? 'translate-x-[-8px]' : ''}`}>
              {[0, 1, 2, 3].map((index) => {
                const isFilled = pin.length > index;
                return (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full border-2 transition-all ${
                      isFilled
                        ? 'bg-stone-900 border-stone-900 scale-110 shadow-xs'
                        : 'bg-white border-stone-300'
                    }`}
                  />
                );
              })}
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="text-[11px] font-bold text-rose-600 flex items-center gap-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2 w-full max-w-[240px] pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleDigitClick(digit)}
                  className="h-12 bg-white hover:bg-stone-200/70 active:bg-stone-300 rounded-xl font-bold text-base text-stone-900 border border-stone-200 shadow-2xs transition-colors flex items-center justify-center"
                >
                  {digit}
                </button>
              ))}
              
              <button
                type="button"
                onClick={handleClear}
                className="h-12 bg-white hover:bg-rose-50 text-stone-500 hover:text-rose-600 rounded-xl font-bold text-xs border border-stone-200 transition-colors flex items-center justify-center"
                title="Borrar todo"
              >
                C
              </button>

              <button
                type="button"
                onClick={() => handleDigitClick('0')}
                className="h-12 bg-white hover:bg-stone-200/70 active:bg-stone-300 rounded-xl font-bold text-base text-stone-900 border border-stone-200 shadow-2xs transition-colors flex items-center justify-center"
              >
                0
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                className="h-12 bg-white hover:bg-stone-200/70 text-stone-700 rounded-xl font-bold border border-stone-200 transition-colors flex items-center justify-center"
                title="Borrar último dígito"
              >
                <Delete className="w-4 h-4" />
              </button>
            </div>

          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-100 bg-stone-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-stone-200 text-stone-700 rounded-xl text-xs font-semibold hover:bg-stone-100 transition-colors"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={pin.length !== 4 || !selectedStaff}
            className="px-5 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 disabled:opacity-40 transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5 text-[#a9b994]" />
            <span>Confirmar Salonero</span>
          </button>
        </div>

      </div>
    </div>
  );
};
