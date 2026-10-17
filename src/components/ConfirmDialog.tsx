import React, { useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, HelpCircle, CheckCircle, X } from 'lucide-react';

export type ConfirmationType = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: ConfirmationType;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  type = 'warning',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const styleConfig = {
    danger: {
      bgIcon: 'bg-rose-100 text-rose-600 border border-rose-200',
      icon: AlertCircle,
      confirmBtn: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30 ring-rose-500/30',
      badge: 'text-rose-700 bg-rose-50 border-rose-200',
    },
    warning: {
      bgIcon: 'bg-amber-100 text-amber-700 border border-amber-200',
      icon: AlertTriangle,
      confirmBtn: 'bg-stone-900 hover:bg-stone-800 text-white shadow-stone-900/30 ring-stone-900/30',
      badge: 'text-amber-800 bg-amber-50 border-amber-200',
    },
    info: {
      bgIcon: 'bg-emerald-100 text-[#588157] border border-emerald-200',
      icon: Info,
      confirmBtn: 'bg-[#588157] hover:bg-[#476946] text-white shadow-[#588157]/30 ring-[#588157]/30',
      badge: 'text-[#476946] bg-[#a9b994]/15 border-[#a9b994]/40',
    },
  }[type];

  const IconComponent = styleConfig.icon;

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div 
        className="w-full max-w-md bg-white border border-stone-200/90 rounded-3xl shadow-2xl p-6 relative overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle decorative top accent */}
        <div 
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            type === 'danger' ? 'bg-rose-500' : type === 'info' ? 'bg-[#588157]' : 'bg-amber-500'
          }`} 
        />

        {/* Close button */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors cursor-pointer"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4 pt-1">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xs ${styleConfig.bgIcon}`}>
            <IconComponent className="w-6 h-6" />
          </div>

          <div className="space-y-1.5 flex-1 pr-4">
            <h3 id="confirm-dialog-title" className="text-base font-black text-stone-900 leading-tight">
              {title}
            </h3>
            <p className="text-xs sm:text-sm text-stone-600 leading-relaxed font-normal">
              {message}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-stone-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-xl text-xs font-black shadow-md transition-all cursor-pointer ${styleConfig.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
