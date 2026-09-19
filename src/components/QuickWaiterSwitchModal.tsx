import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  ArrowRightLeft, 
  KeyRound, 
  ChefHat, 
  Zap, 
  Receipt, 
  ShieldCheck, 
  Delete, 
  Check, 
  AlertCircle, 
  Search, 
  Sparkles,
  UserCheck,
  CheckCircle2,
  UserPlus,
  Phone,
  Lock,
  Unlock,
  Dices,
  Users
} from 'lucide-react';
import { UserProfile, UserRole } from '../types';
import { soundService } from '../services/soundEffects';

interface QuickWaiterSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: UserProfile[];
  currentUser: UserProfile | null;
  onSwitchUser: (staff: UserProfile) => void;
  onAddStaffMember?: (newMember: UserProfile) => void;
  restaurantName?: string;
}

export const QuickWaiterSwitchModal: React.FC<QuickWaiterSwitchModalProps> = ({
  isOpen,
  onClose,
  staffList,
  currentUser,
  onSwitchUser,
  onAddStaffMember,
  restaurantName = 'SaborAI Restaurant'
}) => {
  // Modal active tab: 'switch' (Cambio Rápido) or 'new_user' (Formulario Nuevo Usuario)
  const [modalTab, setModalTab] = useState<'switch' | 'new_user'>('switch');

  // Fast 1-click mode (Instant switch without requiring PIN) vs PIN protection
  const [fastModeWithoutPin, setFastModeWithoutPin] = useState<boolean>(() => {
    try {
      return localStorage.getItem('saborai_fast_user_switch_no_pin') === 'true';
    } catch {
      return false;
    }
  });

  const toggleFastMode = () => {
    const nextVal = !fastModeWithoutPin;
    setFastModeWithoutPin(nextVal);
    try {
      localStorage.setItem('saborai_fast_user_switch_no_pin', String(nextVal));
    } catch {}
    soundService.playKeyClickSound();
  };

  // Only active staff
  const activeStaff = useMemo(() => {
    return staffList.filter(s => s.active !== false);
  }, [staffList]);

  // Priority to someone different from currentUser
  const defaultSelected = useMemo(() => {
    if (activeStaff.length === 0) return null;
    const anotherStaff = activeStaff.find(s => s.id !== currentUser?.id);
    return anotherStaff || activeStaff[0];
  }, [activeStaff, currentUser]);

  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(defaultSelected);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [pin, setPin] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isErrorShake, setIsErrorShake] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // New Quick User Form state
  const [newName, setNewName] = useState<string>('');
  const [newRole, setNewRole] = useState<UserRole>('SALONERO');
  const [newPin, setNewPin] = useState<string>('1234');
  const [newPhone, setNewPhone] = useState<string>('');
  const [newFormError, setNewFormError] = useState<string | null>(null);

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setErrorMessage(null);
      setIsErrorShake(false);
      setIsSuccess(false);
      setSearchTerm('');
      setModalTab('switch');
      setNewFormError(null);
      if (defaultSelected) {
        setSelectedStaff(defaultSelected);
      }
    }
  }, [isOpen, defaultSelected]);

  const handleDigit = (digit: string) => {
    if (isSuccess) return;
    if (pin.length < 4) {
      soundService.playKeyClickSound();
      const nextPin = pin + digit;
      setPin(nextPin);
      setErrorMessage(null);

      // Auto validate on 4th digit
      if (nextPin.length === 4) {
        validatePin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    if (isSuccess) return;
    soundService.playKeyClickSound();
    setPin(prev => prev.slice(0, -1));
    setErrorMessage(null);
  };

  const handleClear = () => {
    if (isSuccess) return;
    soundService.playKeyClickSound();
    setPin('');
    setErrorMessage(null);
  };

  const handleInstantSwitch = (staff: UserProfile) => {
    soundService.playSuccessChime();
    setIsSuccess(true);
    setSelectedStaff(staff);
    setTimeout(() => {
      onSwitchUser(staff);
      onClose();
    }, 350);
  };

  const validatePin = (inputPin: string) => {
    if (!selectedStaff) {
      setErrorMessage('Selecciona primero al colaborador');
      return;
    }

    const expectedPin = selectedStaff.pin || '1234';

    if (inputPin === expectedPin) {
      // Success!
      soundService.playSuccessChime();
      setIsSuccess(true);
      setErrorMessage(null);

      setTimeout(() => {
        onSwitchUser(selectedStaff);
        onClose();
      }, 400);
    } else {
      // Failure
      soundService.playErrorBuzz();
      setErrorMessage('PIN incorrecto. Intenta de nuevo.');
      setIsErrorShake(true);
      setTimeout(() => {
        setIsErrorShake(false);
        setPin('');
      }, 450);
    }
  };

  // Keyboard navigation & numpad handler (for PIN tab)
  useEffect(() => {
    if (!isOpen || isSuccess || modalTab !== 'switch') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in the search input
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (pin.length === 4) {
          validatePin(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, selectedStaff, isSuccess, modalTab]);

  if (!isOpen) return null;

  // Filtered staff list by search query and role
  const filteredStaff = activeStaff.filter(staff => {
    const matchesSearch = staff.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          staff.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (staff.email && staff.email.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesRole = roleFilter === 'ALL' || staff.role === roleFilter;
    return matchesSearch && matchesRole;
  });



  // Handle Quick Create User
  const handleCreateQuickUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNewFormError(null);

    if (!newName.trim()) {
      setNewFormError('Ingresa el nombre del colaborador.');
      soundService.playErrorBuzz();
      return;
    }

    const formattedPin = (newPin || '1234').padStart(4, '0').slice(0, 4);

    const newMember: UserProfile = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: newName.trim(),
      email: `${newName.toLowerCase().replace(/[^a-z0-9]/g, '')}@saborai.cr`,
      phone: newPhone.trim() || '+506 8888-0000',
      restaurantName: restaurantName,
      role: newRole,
      pin: formattedPin,
      active: true
    };

    if (onAddStaffMember) {
      onAddStaffMember(newMember);
    }

    soundService.playSuccessChime();
    onSwitchUser(newMember);
    onClose();
  };

  const generateRandomPin = () => {
    const random = Math.floor(1000 + Math.random() * 9000).toString();
    setNewPin(random);
    soundService.playKeyClickSound();
  };

  const getRoleConfig = (role: UserRole) => {
    switch (role) {
      case 'SALONERO':
      case 'WAITER':
        return { 
          label: 'Salonero', 
          color: 'bg-emerald-50 text-emerald-800 border-emerald-200', 
          badgeColor: 'bg-emerald-500 text-white',
          icon: ChefHat 
        };
      case 'SALONERO_CAJA':
        return { 
          label: 'Salonero c/ Caja', 
          color: 'bg-purple-50 text-purple-800 border-purple-200', 
          badgeColor: 'bg-purple-600 text-white',
          icon: Zap 
        };
      case 'CAJERO':
        return { 
          label: 'Cajero', 
          color: 'bg-amber-50 text-amber-800 border-amber-200', 
          badgeColor: 'bg-amber-600 text-white',
          icon: Receipt 
        };
      case 'ADMIN':
      default:
        return { 
          label: 'Administrador', 
          color: 'bg-blue-50 text-blue-800 border-blue-200', 
          badgeColor: 'bg-blue-600 text-white',
          icon: ShieldCheck 
        };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header with Navigation Tabs */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-xs shrink-0">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-stone-900 flex items-center gap-2">
                <span>Cambio Rápido de Usuario</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#a9b994]/25 text-stone-800 border border-[#a9b994]/50">
                  Turno Activo
                </span>
              </h2>
              <div className="flex items-center gap-2 text-xs text-stone-500 mt-0.5">
                <span>Sesión activa:</span>
                <strong className="text-stone-900 font-bold">{currentUser?.name || 'Ninguno'}</strong>
                {currentUser && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-stone-200 text-stone-700 font-bold">
                    {currentUser.role}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Modal Tabs: Switch vs New User Form */}
            <div className="flex items-center bg-stone-200/70 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setModalTab('switch');
                  soundService.playKeyClickSound();
                }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  modalTab === 'switch'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-[#588157]" />
                <span>Colaboradores</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalTab('new_user');
                  soundService.playKeyClickSound();
                }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  modalTab === 'new_user'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                <span>+ Nuevo Usuario</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors shrink-0"
              title="Cerrar ventana"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================== */}
        {/* TAB 1: SELECCIÓN RÁPIDA DE COLABORADOR & PIN               */}
        {/* ========================================================== */}
        {modalTab === 'switch' && (
          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-y-auto">
            
            {/* Left Side: Select Staff by Name & Role (7 cols) */}
            <div className="md:col-span-7 flex flex-col space-y-3">
              
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-[#588157]" />
                  <span>1. Selecciona al Colaborador:</span>
                </label>

                {/* Fast Mode Toggle */}
                <button
                  type="button"
                  onClick={toggleFastMode}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border flex items-center gap-1 transition-all ${
                    fastModeWithoutPin
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-stone-100 border-stone-200 text-stone-500 hover:text-stone-800'
                  }`}
                  title={fastModeWithoutPin ? 'Cambio instantáneo en 1 clic activado' : 'Requiere digitar PIN de 4 dígitos'}
                >
                  {fastModeWithoutPin ? <Unlock className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-stone-500" />}
                  <span>{fastModeWithoutPin ? '1-Clic (Sin PIN)' : 'Con PIN'}</span>
                </button>
              </div>

              {/* Search & Role Filter Pills */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por nombre o rol..."
                    className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:bg-white transition-all"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Role Filters */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
                  {[
                    { id: 'ALL', label: 'Todos' },
                    { id: 'SALONERO', label: 'Saloneros' },
                    { id: 'CAJERO', label: 'Cajeros' },
                    { id: 'SALONERO_CAJA', label: 'Salonero/Caja' },
                    { id: 'ADMIN', label: 'Admin' }
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => {
                        setRoleFilter(filter.id as any);
                        soundService.playKeyClickSound();
                      }}
                      className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-colors ${
                        roleFilter === filter.id
                          ? 'bg-stone-900 text-white shadow-2xs'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Staff Cards List */}
              <div className="space-y-2 overflow-y-auto max-h-[300px] pr-1 scrollbar-thin">
                {filteredStaff.map((staff) => {
                  const isSelected = selectedStaff?.id === staff.id;
                  const isCurrentActive = currentUser?.id === staff.id;
                  const roleConfig = getRoleConfig(staff.role);
                  const Icon = roleConfig.icon;

                  return (
                    <div
                      key={staff.id}
                      onClick={() => {
                        if (fastModeWithoutPin) {
                          handleInstantSwitch(staff);
                        } else {
                          setSelectedStaff(staff);
                          setPin('');
                          setErrorMessage(null);
                          soundService.playKeyClickSound();
                        }
                      }}
                      className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between group cursor-pointer ${
                        isSelected
                          ? 'bg-stone-900 text-white border-stone-900 shadow-md ring-2 ring-stone-900/20'
                          : 'bg-stone-50/70 border-stone-200 text-stone-800 hover:bg-white hover:border-stone-300 hover:shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0 transition-colors ${
                          isSelected 
                            ? 'bg-[#a9b994] text-stone-950' 
                            : 'bg-stone-200 text-stone-700 group-hover:bg-stone-300'
                        }`}>
                          {staff.name.substring(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-stone-900'}`}>
                              {staff.name}
                            </span>
                            {isCurrentActive && (
                              <span className={`px-1.5 py-0.2 rounded-md text-[9px] font-bold ${
                                isSelected ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/40' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                En Turno
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.2 rounded-full border ${
                              isSelected 
                                ? 'bg-stone-800 text-stone-200 border-stone-700' 
                                : roleConfig.color
                            }`}>
                              <Icon className="w-2.5 h-2.5" />
                              <span>{roleConfig.label}</span>
                            </span>

                            {staff.phone && (
                              <span className={`text-[9px] ${isSelected ? 'text-stone-400' : 'text-stone-400'}`}>
                                • {staff.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {fastModeWithoutPin ? (
                          <button
                            type="button"
                            className="px-2.5 py-1 bg-[#a9b994] hover:bg-[#97a783] text-stone-950 font-black text-[10px] rounded-lg shadow-2xs transition-transform active:scale-95"
                          >
                            Entrar
                          </button>
                        ) : isSelected ? (
                          <div className="w-6 h-6 rounded-full bg-[#a9b994] text-stone-950 flex items-center justify-center animate-in zoom-in-50 duration-100">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {filteredStaff.length === 0 && (
                  <div className="p-6 text-center text-stone-400 text-xs bg-stone-50 rounded-2xl border border-dashed border-stone-200 space-y-2">
                    <p>No se encontró ningún colaborador con "{searchTerm}".</p>
                    <button
                      type="button"
                      onClick={() => setModalTab('new_user')}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 underline"
                    >
                      + Registrar a este colaborador ahora
                    </button>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Al cambiar de usuario, las comandas, comandas de cocina KDS y facturas quedarán asignadas al colaborador seleccionado.
                </span>
              </div>
            </div>

            {/* Right Side: Modern Touch PIN Pad (5 cols) */}
            <div className="md:col-span-5 flex flex-col items-center justify-between bg-stone-50 rounded-3xl p-4 sm:p-5 border border-stone-200/90 shadow-2xs">
              
              {/* Selected Waiter Preview & Security Prompt */}
              <div className="text-center w-full">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-200/70 text-stone-700 text-[11px] font-bold mb-2">
                  <KeyRound className="w-3 h-3 text-stone-600" />
                  <span>2. PIN de Autorización</span>
                </div>

                <div className="text-sm font-black text-stone-900 truncate">
                  {selectedStaff ? selectedStaff.name : 'Selecciona un colaborador'}
                </div>

              </div>

              {/* PIN Dots Display */}
              <div className="my-2.5 flex flex-col items-center">
                <div className={`flex items-center justify-center gap-3 transition-transform duration-150 ${isErrorShake ? '-translate-x-2 translate-x-2' : ''}`}>
                  {[0, 1, 2, 3].map((index) => {
                    const isFilled = pin.length > index;
                    return (
                      <div
                        key={index}
                        className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                          isSuccess
                            ? 'bg-emerald-500 border-emerald-500 scale-125 shadow-sm'
                            : isFilled
                            ? 'bg-stone-900 border-stone-900 scale-110 shadow-xs ring-4 ring-stone-900/10'
                            : 'bg-white border-stone-300'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Dynamic Feedback Banner */}
                <div className="h-6 flex items-center justify-center mt-2">
                  {isSuccess ? (
                    <div className="text-xs font-bold text-emerald-700 flex items-center gap-1 animate-in zoom-in duration-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>¡Correcto! Entrando...</span>
                    </div>
                  ) : errorMessage ? (
                    <div className="text-xs font-bold text-rose-600 flex items-center gap-1 animate-in fade-in duration-150">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{errorMessage}</span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-stone-400">
                      {pin.length === 0 ? 'Digita tu PIN de 4 números' : `${4 - pin.length} dígitos restantes`}
                    </span>
                  )}
                </div>
              </div>

              {/* Modern Numeric Keypad */}
              <div className="grid grid-cols-3 gap-2 w-full max-w-[230px]">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={isSuccess}
                    onClick={() => handleDigit(digit)}
                    className="h-11 sm:h-12 bg-white hover:bg-stone-200 active:bg-stone-300 rounded-2xl font-bold text-base text-stone-900 border border-stone-200/90 shadow-2xs transition-all flex items-center justify-center select-none active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}

                <button
                  type="button"
                  disabled={isSuccess}
                  onClick={handleClear}
                  className="h-11 sm:h-12 bg-white hover:bg-rose-50 text-stone-500 hover:text-rose-600 active:bg-rose-100 rounded-2xl font-bold text-xs border border-stone-200 transition-all flex items-center justify-center select-none active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Borrar todo"
                >
                  C
                </button>

                <button
                  type="button"
                  disabled={isSuccess}
                  onClick={() => handleDigit('0')}
                  className="h-11 sm:h-12 bg-white hover:bg-stone-200 active:bg-stone-300 rounded-2xl font-bold text-base text-stone-900 border border-stone-200/90 shadow-2xs transition-all flex items-center justify-center select-none active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  0
                </button>

                <button
                  type="button"
                  disabled={isSuccess}
                  onClick={handleBackspace}
                  className="h-11 sm:h-12 bg-white hover:bg-stone-200 active:bg-stone-300 text-stone-700 rounded-2xl font-bold border border-stone-200 transition-all flex items-center justify-center select-none active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Borrar dígito anterior"
                >
                  <Delete className="w-4 h-4" />
                </button>
              </div>

              {/* Direct Instant Action */}
              <button
                type="button"
                onClick={() => {
                  if (selectedStaff) {
                    handleInstantSwitch(selectedStaff);
                  }
                }}
                disabled={!selectedStaff || isSuccess}
                className="w-full mt-3 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 text-[11px] font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                <span>Entrar directo sin digitar PIN</span>
              </button>

            </div>

          </div>
        )}

        {/* ========================================================== */}
        {/* TAB 2: FORMULARIO MODERNO DE REGISTRO RÁPIDO DE USUARIO   */}
        {/* ========================================================== */}
        {modalTab === 'new_user' && (
          <form onSubmit={handleCreateQuickUserSubmit} className="p-6 sm:p-8 space-y-5 overflow-y-auto">
            <div className="border-b border-stone-200 pb-3">
              <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#588157]" />
                <span>Registrar Nuevo Colaborador para Cambio Rápido</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Crea un nuevo usuario en 10 segundos. Podrás asignarlo a su turno y empezar a comandar o facturar de inmediato.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Nombre */}
              <div className="space-y-1 sm:col-span-2">
                <label className="font-bold text-stone-800 flex items-center gap-1">
                  <span>Nombre Completo del Colaborador:</span>
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej. Andrés Solís, Mariana Gómez..."
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-stone-900 outline-none"
                />
              </div>

              {/* Rol */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className="font-bold text-stone-800 block">
                  Rol y Permisos Operativos:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'SALONERO', label: 'Salonero', icon: ChefHat, desc: 'Comandar mesas y pedidos' },
                    { id: 'CAJERO', label: 'Cajero', icon: Receipt, desc: 'Cobros y cierres de caja' },
                    { id: 'SALONERO_CAJA', label: 'Salonero/Caja', icon: Zap, desc: 'Comandas y cobros duales' },
                    { id: 'ADMIN', label: 'Administrador', icon: ShieldCheck, desc: 'Control total de sistema' }
                  ].map((r) => {
                    const isSelected = newRole === r.id;
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setNewRole(r.id as UserRole);
                          soundService.playKeyClickSound();
                        }}
                        className={`p-3 rounded-2xl border text-left transition-all ${
                          isSelected
                            ? 'bg-stone-900 text-white border-stone-900 shadow-md ring-2 ring-stone-900/20'
                            : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold mb-0.5">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-[#a9b994]' : 'text-stone-500'}`} />
                          <span className="text-xs">{r.label}</span>
                        </div>
                        <p className={`text-[10px] leading-tight ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                          {r.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PIN de 4 Dígitos */}
              <div className="space-y-1">
                <label className="font-bold text-stone-800 flex items-center justify-between">
                  <span>PIN de Autorización (4 Dígitos):</span>
                  <button
                    type="button"
                    onClick={generateRandomPin}
                    className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                  >
                    <Dices className="w-3 h-3" />
                    <span>Aleatorio</span>
                  </button>
                </label>
                <input
                  type="text"
                  maxLength={4}
                  required
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="1234"
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-center text-base font-mono font-black text-stone-900 tracking-widest focus:bg-white focus:ring-2 focus:ring-stone-900 outline-none"
                />
              </div>

              {/* Teléfono */}
              <div className="space-y-1">
                <label className="font-bold text-stone-800 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-stone-500" />
                  <span>Teléfono o WhatsApp (Opcional):</span>
                </label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+506 8888-0000"
                  className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-stone-900 outline-none"
                />
              </div>
            </div>

            {newFormError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{newFormError}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setModalTab('switch')}
                className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Volver a Selección
              </button>

              <button
                type="submit"
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <Zap className="w-4 h-4 text-[#a9b994]" />
                <span>Guardar y Entrar como este Usuario</span>
              </button>
            </div>
          </form>
        )}

        {/* Footer Actions for Switch Tab */}
        {modalTab === 'switch' && (
          <div className="px-6 py-3.5 border-t border-stone-200 bg-stone-50 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[11px] text-stone-400">
                Validación automática al 4to dígito
              </span>
              <button
                type="button"
                onClick={() => {
                  if (pin.length === 4) {
                    validatePin(pin);
                  } else {
                    setErrorMessage('Ingresa los 4 dígitos');
                  }
                }}
                disabled={pin.length !== 4 || isSuccess || !selectedStaff}
                className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-black hover:bg-stone-800 disabled:opacity-40 transition-all shadow-xs flex items-center gap-2 active:scale-95 cursor-pointer"
              >
                <Check className="w-4 h-4 text-[#a9b994]" />
                <span>Confirmar Cambio</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
