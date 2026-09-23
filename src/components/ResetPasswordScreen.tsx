import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle2, ArrowRight } from 'lucide-react';

interface ResetPasswordScreenProps {
  token: string;
  onSuccess: () => void;
}

const FIELD_CLASS = "w-full px-4 py-3 rounded-xl bg-stone-800/60 border border-stone-700 text-white placeholder-stone-600 focus:border-[#a9b994] focus:outline-none text-sm transition-colors disabled:opacity-50";
const LABEL_CLASS = "block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1.5";

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ token, onSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setIsProcessing(true);

    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });

      const data = await res.json();
      setIsProcessing(false);

      if (!res.ok) {
        setError(data.error || 'Error al actualizar la contraseña.');
        return;
      }

      setSuccess(true);
    } catch (err) {
      setIsProcessing(false);
      setError('Error de conexión con el servidor.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-950 via-stone-900 to-[#1e2018] flex items-center justify-center p-4 sm:p-6">
      <div className="bg-stone-900/70 border border-stone-700/40 rounded-3xl p-7 sm:p-9 max-w-md w-full shadow-2xl backdrop-blur-sm">
        
        <div className="text-center mb-8">
          <h3 className="text-2xl font-black text-white mb-2">Nueva Contraseña</h3>
          <p className="text-sm text-stone-400 leading-relaxed">
            Por favor, ingresa tu nueva contraseña para acceder a Saborai POS.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-xs text-red-400 mb-6">
            ⚠️ {error}
          </div>
        )}

        {success ? (
          <div className="text-center animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-[#a9b994]/20 border border-[#a9b994]/40 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-[#a9b994]" />
            </div>
            <h4 className="text-xl font-bold text-white mb-2">¡Contraseña Actualizada!</h4>
            <p className="text-sm text-stone-400 mb-6">
              Tu contraseña se ha cambiado correctamente.
            </p>
            <button
              onClick={onSuccess}
              className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] transition-all flex items-center justify-center gap-2"
            >
              <span>Ir a Iniciar Sesión</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={LABEL_CLASS}>Nueva Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isProcessing}
                  className={`${FIELD_CLASS} pl-10 pr-10`}
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={LABEL_CLASS}>Confirmar Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Repite tu contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isProcessing}
                  className={`${FIELD_CLASS} pl-10 pr-10`}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-4 bg-[#a9b994] text-stone-900 rounded-xl font-bold text-sm hover:bg-[#bccaad] active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
            >
              {isProcessing ? <span className="animate-pulse">Guardando...</span> : <span>Restablecer Contraseña</span>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
