import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  User, 
  Mail, 
  Phone, 
  Store, 
  Lock, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  ShieldCheck, 
  ChefHat,
  Receipt,
  Sparkles,
  Zap
} from 'lucide-react';
import { UserProfile, TenantInfo, UserRole } from '../types';
import { notionService } from '../services/notionService';

interface AuthScreenProps {
  onLoginSuccess: (user: UserProfile, tenant: TenantInfo) => void;
  onOpenNotion?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess, onOpenNotion }) => {
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN');

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim() || !email.trim() || !phone.trim() || !restaurantName.trim() || !password) {
      setErrorMessage('Por favor completa todos los campos requeridos.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);

    setTimeout(() => {
      const newUser: UserProfile = {
        id: `usr_${Date.now()}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        restaurantName: restaurantName.trim(),
        role: selectedRole,
        active: true
      };

      const newTenant: TenantInfo = {
        id: `tenant_${Date.now()}`,
        name: restaurantName.trim(),
        cedulaJuridica: '3-101-998877',
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        location: 'San José, Costa Rica',
        plan: 'pro',
        status: 'ACTIVE',
        currency: 'CRC',
        monthlyFee: 45000
      };

      // Save credentials in local storage
      try {
        localStorage.setItem('saborai_user', JSON.stringify(newUser));
        localStorage.setItem('saborai_tenant', JSON.stringify(newTenant));
      } catch {}

      // Automatically register user in Notion database
      notionService.recordUserRegistration(newUser, newTenant).catch(err => {
        console.warn('Background sync with Notion encountered an issue:', err);
      });

      setIsSubmitting(false);
      onLoginSuccess(newUser, newTenant);
    }, 600);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Ingresa tu correo y contraseña.');
      return;
    }

    setIsSubmitting(true);

    setTimeout(() => {
      // Check if user exists in local storage
      let user: UserProfile = {
        id: 'usr_demo_01',
        name: 'Administrador General',
        email: email.trim().toLowerCase(),
        phone: '+506 8888-4500',
        restaurantName: 'Restaurante Fuego & Palmera',
        role: 'ADMIN'
      };

      let tenant: TenantInfo = {
        id: 'tenant_saborai_cr_001',
        name: 'Restaurante Fuego & Palmera S.A.',
        cedulaJuridica: '3-101-789456',
        email: email.trim().toLowerCase(),
        phone: '+506 2289-4500',
        location: 'Escazú Village, San José, Costa Rica',
        plan: 'pro',
        status: 'ACTIVE',
        currency: 'CRC',
        monthlyFee: 45000
      };

      try {
        const savedUser = localStorage.getItem('saborai_user');
        const savedTenant = localStorage.getItem('saborai_tenant');
        if (savedUser && savedTenant) {
          user = JSON.parse(savedUser);
          tenant = JSON.parse(savedTenant);
        }
      } catch {}

      setIsSubmitting(false);
      onLoginSuccess(user, tenant);
    }, 600);
  };

  const handleQuickDemoAccess = () => {
    const demoUser: UserProfile = {
      id: 'usr_demo_fuego',
      name: 'Kevin Murillo',
      email: 'administracion@fuegopalmera.cr',
      phone: '+506 2289-4500',
      restaurantName: 'Restaurante Fuego & Palmera S.A.',
      role: 'ADMIN'
    };

    const demoTenant: TenantInfo = {
      id: 'tenant_saborai_cr_001',
      name: 'Restaurante Fuego & Palmera S.A.',
      cedulaJuridica: '3-101-789456',
      email: 'administracion@fuegopalmera.cr',
      phone: '+506 2289-4500',
      location: 'Escazú Village, San José, Costa Rica',
      plan: 'pro',
      status: 'ACTIVE',
      currency: 'CRC',
      monthlyFee: 45000
    };

    try {
      localStorage.setItem('saborai_user', JSON.stringify(demoUser));
      localStorage.setItem('saborai_tenant', JSON.stringify(demoTenant));
    } catch {}

    onLoginSuccess(demoUser, demoTenant);
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-stone-900 flex flex-col justify-between p-4 sm:p-8 font-sans selection:bg-[#a9b994]/30">
      
      {/* Top Brand Bar */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <BrandLogo variant="wordmark" size="md" />
        <div className="flex items-center gap-2 text-xs text-stone-500 font-medium">
          <ShieldCheck className="w-4 h-4 text-[#588157]" />
          <span>Acceso Seguro POS Costa Rica</span>
        </div>
      </div>

      {/* Main Authentication Card */}
      <div className="max-w-md w-full mx-auto my-8 bg-white border border-stone-200 rounded-3xl p-7 sm:p-8 shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-stone-100 p-1 rounded-2xl border border-stone-200/80">
          <button
            type="button"
            onClick={() => {
              setAuthMode('register');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
              authMode === 'register'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-500 hover:text-stone-900'
            }`}
          >
            Registrarse
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthMode('login');
              setErrorMessage(null);
            }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
              authMode === 'login'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-500 hover:text-stone-900'
            }`}
          >
            Iniciar Sesión
          </button>
        </div>

        {/* Title */}
        <div>
          <h2 className="text-xl font-bold text-stone-900 tracking-tight">
            {authMode === 'register' ? 'Crear cuenta de restaurante' : 'Bienvenido a tu POS'}
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            {authMode === 'register' 
              ? 'Ingresa los datos para registrar tu negocio y comenzar a operar.' 
              : 'Ingresa con tu correo y contraseña para abrir el turno.'}
          </p>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
            {errorMessage}
          </div>
        )}

        {/* Form */}
        {authMode === 'register' ? (
          <form onSubmit={handleRegister} className="space-y-3.5 text-xs font-semibold text-stone-700">
            
            {/* Nombre */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Tu Nombre Completo</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  placeholder="Ej. Kevin Murillo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
              </div>
            </div>

            {/* Correo */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Correo Electrónico</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="email"
                  placeholder="ejemplo@turestaurante.cr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
              </div>
            </div>

            {/* Teléfono */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Teléfono Móvil / WhatsApp</label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="tel"
                  placeholder="+506 8888-4500"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
              </div>
            </div>

            {/* Nombre del Restaurante */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Nombre del Restaurante / Café</label>
              <div className="relative">
                <Store className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  placeholder="Ej. Bistro & Café Escalante"
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
              </div>
            </div>

            {/* Crear Contraseña */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Crear Contraseña</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Selector de Rol en el Restaurante */}
            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] font-bold text-stone-600 uppercase">
                Rol del Colaborador
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'ADMIN', label: 'Administrador', desc: 'Gerencia y acceso total', icon: ShieldCheck, color: 'text-blue-600' },
                  { id: 'SALONERO', label: 'Salonero', desc: 'Mesas, comandas y avisos', icon: ChefHat, color: 'text-emerald-600' },
                  { id: 'CAJERO', label: 'Cajero', desc: 'Facturación Hacienda y cobros', icon: Receipt, color: 'text-amber-600' },
                  { id: 'SALONERO_CAJA', label: 'Salonero con Caja', desc: 'Comandas y cobro en mesa', icon: Zap, color: 'text-purple-600' }
                ].map((r) => {
                  const Icon = r.icon;
                  const isSel = selectedRole === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRole(r.id as UserRole)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSel 
                          ? 'bg-white border-stone-900 ring-2 ring-stone-900/10 shadow-xs' 
                          : 'bg-stone-50 border-stone-200 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-3.5 h-3.5 ${isSel ? r.color : 'text-stone-400'}`} />
                        <span className="text-xs font-bold text-stone-900">{r.label}</span>
                      </div>
                      <span className="text-[10px] text-stone-500 block mt-0.5 leading-tight">{r.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 mt-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs"
            >
              {isSubmitting ? (
                <span>Creando tu cuenta de restaurante...</span>
              ) : (
                <>
                  <span>Registrar y Entrar al POS</span>
                  <ArrowRight className="w-4 h-4 text-[#a9b994]" />
                </>
              )}
            </button>

          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4 text-xs font-semibold text-stone-700">
            
            {/* Correo */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Correo Electrónico</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="email"
                  placeholder="ejemplo@turestaurante.cr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-[11px] font-bold text-stone-600 uppercase mb-1">Contraseña</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#588157]/40"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 mt-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs"
            >
              {isSubmitting ? (
                <span>Iniciando sesión...</span>
              ) : (
                <>
                  <span>Iniciar Sesión</span>
                  <ArrowRight className="w-4 h-4 text-[#a9b994]" />
                </>
              )}
            </button>

          </form>
        )}

        {/* Fast Access by Role Demo Buttons */}
        <div className="pt-4 border-t border-stone-100 space-y-2">
          <span className="text-[11px] text-stone-400 font-medium block text-center">
            Prueba el sistema al instante con cualquiera de los 4 roles:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {[
              { id: 'ADMIN' as UserRole, label: 'Admin', name: 'Carlos Admin', icon: ShieldCheck, bg: 'hover:bg-blue-50 hover:text-blue-900' },
              { id: 'SALONERO' as UserRole, label: 'Salonero', name: 'Kevin Murillo', icon: ChefHat, bg: 'hover:bg-emerald-50 hover:text-emerald-900' },
              { id: 'CAJERO' as UserRole, label: 'Cajero', name: 'Laura Caja', icon: Receipt, bg: 'hover:bg-amber-50 hover:text-amber-900' },
              { id: 'SALONERO_CAJA' as UserRole, label: 'Salonero c/ Caja', name: 'Esteban Dual', icon: Zap, bg: 'hover:bg-purple-50 hover:text-purple-900' },
            ].map((d) => {
              const Icon = d.icon;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    const demoUser: UserProfile = {
                      id: `usr_demo_${d.id.toLowerCase()}`,
                      name: d.name,
                      email: `${d.id.toLowerCase()}@fuegopalmera.cr`,
                      phone: '+506 2289-4500',
                      restaurantName: 'Restaurante Fuego & Palmera S.A.',
                      role: d.id,
                      active: true
                    };
                    const demoTenant: TenantInfo = {
                      id: 'tenant_saborai_cr_001',
                      name: 'Restaurante Fuego & Palmera S.A.',
                      cedulaJuridica: '3-101-789456',
                      email: 'administracion@fuegopalmera.cr',
                      phone: '+506 2289-4500',
                      location: 'Escazú Village, San José, Costa Rica',
                      plan: 'pro',
                      status: 'ACTIVE',
                      currency: 'CRC',
                      monthlyFee: 45000
                    };
                    try {
                      localStorage.setItem('saborai_user', JSON.stringify(demoUser));
                      localStorage.setItem('saborai_tenant', JSON.stringify(demoTenant));
                    } catch {}
                    onLoginSuccess(demoUser, demoTenant);
                  }}
                  className={`p-2 bg-stone-100 text-stone-800 rounded-xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 border border-stone-200 ${d.bg}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>

          {onOpenNotion && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenNotion}
                className="text-[11px] text-stone-500 hover:text-stone-900 font-semibold flex items-center justify-center gap-1.5 mx-auto transition-colors py-1 px-3 rounded-lg hover:bg-stone-100"
              >
                <span className="w-4 h-4 rounded-md bg-stone-900 text-white font-serif font-black text-[10px] flex items-center justify-center">N</span>
                <span>Configurar Conexión con Notion</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Footer Feature Badges */}
      <div className="max-w-2xl w-full mx-auto grid grid-cols-3 gap-2 text-center text-[11px] text-stone-500">
        <div className="flex items-center justify-center gap-1.5 p-2 bg-white/60 rounded-xl border border-stone-200/60">
          <Zap className="w-3.5 h-3.5 text-[#588157]" />
          <span className="hidden sm:inline">Modo Offline Local</span>
          <span className="sm:hidden">Offline</span>
        </div>
        <div className="flex items-center justify-center gap-1.5 p-2 bg-white/60 rounded-xl border border-stone-200/60">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#588157]" />
          <span>Hacienda CR v4.3</span>
        </div>
        <div className="flex items-center justify-center gap-1.5 p-2 bg-white/60 rounded-xl border border-stone-200/60">
          <ShieldCheck className="w-3.5 h-3.5 text-[#588157]" />
          <span>Multi-Dispositivo</span>
        </div>
      </div>

    </div>
  );
};
