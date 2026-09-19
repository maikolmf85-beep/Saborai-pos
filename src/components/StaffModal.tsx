import React, { useState } from 'react';
import { 
  X, 
  Users, 
  UserPlus, 
  ShieldCheck, 
  ChefHat, 
  Receipt, 
  Zap, 
  KeyRound, 
  Mail, 
  Phone, 
  Check, 
  CheckCircle2, 
  Sparkles, 
  ArrowRightLeft,
  UserCheck
} from 'lucide-react';
import { UserProfile, TenantInfo, UserRole } from '../types';
import { notionService, formatUserRole } from '../services/notionService';

interface StaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  currentTenant: TenantInfo;
  staffList: UserProfile[];
  onAddStaffMember: (newMember: UserProfile) => void;
  onSelectUser: (user: UserProfile) => void;
  onToggleUserActive?: (userId: string) => void;
  onOpenQuickSwitch?: () => void;
}

export const StaffModal: React.FC<StaffModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  currentTenant,
  staffList,
  onAddStaffMember,
  onSelectUser,
  onToggleUserActive,
  onOpenQuickSwitch
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('SALONERO');
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const roleDefinitions: {
    id: UserRole;
    label: string;
    description: string;
    badgeColor: string;
    icon: any;
  }[] = [
    {
      id: 'ADMIN',
      label: 'Administrador',
      description: 'Acceso total: Precios, inventario, reportes y configuración de sistema.',
      badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
      icon: ShieldCheck
    },
    {
      id: 'SALONERO',
      label: 'Salonero',
      description: 'Atención de mesas, toma de pedidos y recepción de avisos de platos listos.',
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      icon: ChefHat
    },
    {
      id: 'CAJERO',
      label: 'Cajero',
      description: 'Facturación Hacienda v4.3, pagos mixtos, división de cuentas y arqueos.',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
      icon: Receipt
    },
    {
      id: 'SALONERO_CAJA',
      label: 'Salonero con Caja',
      description: 'Rol híbrido: Atención de mesas + Cobro inmediato y emisión de ticket en mesa.',
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
      icon: Zap
    }
  ];

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setFeedback(null);

    const newStaff: UserProfile = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name: name.trim(),
      email: email.trim().toLowerCase() || `${name.trim().toLowerCase().replace(/\s+/g, '.')}@${currentTenant.name.toLowerCase().replace(/\s+/g, '')}.cr`,
      phone: phone.trim() || '+506 2200-0000',
      restaurantName: currentTenant.name,
      role: role,
      pin: pin.trim() || '1234',
      active: true
    };

    // Save locally
    onAddStaffMember(newStaff);

    // Sync in background to Notion
    notionService.recordUserRegistration(newStaff, currentTenant).catch(() => {});

    setIsSubmitting(false);
    setFeedback(`¡Colaborador "${newStaff.name}" (${formatUserRole(newStaff.role)}) registrado con éxito!`);
    
    // Reset form
    setName('');
    setEmail('');
    setPhone('');
    setPin('');
    setRole('SALONERO');

    setTimeout(() => setFeedback(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-stone-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-stone-900 text-[#a9b994] flex items-center justify-center shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">Personal & Registro de Usuarios</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-700">
                  {staffList.length} colaboradores
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Administra los perfiles de tu equipo: Saloneros, Cajeros, Administradores y Saloneros con Caja.
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {feedback && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-2 duration-150">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {/* New User Registration Form */}
          <form onSubmit={handleCreateUser} className="bg-stone-50 border border-stone-200/80 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-stone-600" />
                Registrar Nuevo Colaborador
              </h3>
              <span className="text-[11px] text-stone-400">Se sincroniza automáticamente en Notion</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-stone-700">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej. Daniel Rojas"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-stone-700">Correo Electrónico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ej. daniel@restaurante.cr"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-stone-700">Teléfono / WhatsApp</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+506 8888-0000"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-stone-700">PIN Rápido (4 dígitos)</label>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="ej. 1234"
                  className="w-full bg-white border border-stone-300 rounded-xl px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 font-mono focus:outline-none focus:ring-2 focus:ring-stone-900/10 focus:border-stone-900"
                />
              </div>
            </div>

            {/* Role Selection Grid */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold text-stone-700 block">
                Selecciona el Rol en el Restaurante:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                {roleDefinitions.map((rDef) => {
                  const Icon = rDef.icon;
                  const isSelected = role === rDef.id;

                  return (
                    <button
                      key={rDef.id}
                      type="button"
                      onClick={() => setRole(rDef.id)}
                      className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? 'bg-white border-stone-900 ring-2 ring-stone-900/10 shadow-xs'
                          : 'bg-white/70 border-stone-200 hover:bg-white hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-stone-900' : 'text-stone-500'}`} />
                          <span className="text-xs font-bold text-stone-900">{rDef.label}</span>
                        </div>
                        {isSelected && (
                          <div className="w-4 h-4 rounded-full bg-stone-900 text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-stone-500 leading-tight">
                        {rDef.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2"
              >
                <UserPlus className="w-3.5 h-3.5 text-[#a9b994]" />
                <span>Registrar Colaborador</span>
              </button>
            </div>
          </form>

          {/* Active Collaborators List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-stone-600" />
              Colaboradores del Restaurante ({staffList.length})
            </h3>

            <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100/75 border-b border-stone-200 text-stone-600 font-bold">
                    <tr>
                      <th className="px-4 py-2.5">Colaborador</th>
                      <th className="px-4 py-2.5">Rol Asignado</th>
                      <th className="px-4 py-2.5">Contacto</th>
                      <th className="px-4 py-2.5">PIN Rápido</th>
                      <th className="px-4 py-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {staffList.map((member) => {
                      const isCurrent = currentUser?.id === member.id;
                      const roleDef = roleDefinitions.find(r => r.id === member.role) || roleDefinitions[1];
                      const Icon = roleDef.icon;

                      return (
                        <tr key={member.id} className={`hover:bg-stone-50/60 transition-colors ${isCurrent ? 'bg-[#a9b994]/10' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs">
                                {member.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-stone-900 flex items-center gap-1.5">
                                  <span>{member.name}</span>
                                  {isCurrent && (
                                    <span className="px-1.5 py-0.5 rounded-md bg-stone-900 text-white text-[9px] font-bold">
                                      En Turno
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-stone-400 font-mono">{member.id}</div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${roleDef.badgeColor}`}>
                              <Icon className="w-3 h-3" />
                              <span>{roleDef.label}</span>
                            </span>
                          </td>

                          <td className="px-4 py-3 text-stone-600">
                            <div>{member.email}</div>
                            <div className="text-[10px] text-stone-400">{member.phone}</div>
                          </td>

                          <td className="px-4 py-3 font-mono text-stone-500 text-[11px]">
                            {member.pin ? '••••' : '1234'}
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {!isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    if (onOpenQuickSwitch) {
                                      onOpenQuickSwitch();
                                    } else {
                                      onSelectUser(member);
                                    }
                                  }}
                                  className="px-3 py-1 bg-stone-100 hover:bg-stone-900 hover:text-white text-stone-800 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 shadow-2xs"
                                  title="Iniciar turno con este usuario solicitando PIN"
                                >
                                  <ArrowRightLeft className="w-3 h-3" />
                                  <span>Cambiar Turno</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex items-center justify-between">
          <span className="text-[11px] text-stone-500">
            Los roles asignados determinan las pantallas de cobro, comandas y permisos operativos del POS.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-colors shadow-xs"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
