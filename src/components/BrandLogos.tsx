import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'wordmark' | 'stacked' | 'isotype';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const BrandLogo: React.FC<LogoProps> = ({ 
  className = '', 
  variant = 'full',
  size = 'md' 
}) => {
  const logoUrl = '/assets/logos/saborai-logo.png';

  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20'
  };

  const textSizes = {
    sm: 'text-base',
    md: 'text-lg sm:text-xl',
    lg: 'text-2xl sm:text-3xl',
    xl: 'text-4xl'
  };

  const badgeSizes = {
    sm: 'text-[8px] px-1 py-0.2',
    md: 'text-[9px] px-1.5 py-0.5',
    lg: 'text-[11px] px-2 py-0.5',
    xl: 'text-xs px-2.5 py-1'
  };

  // 1. Isotipo (Solo el icono estilizado oficial "S" verde y carbón)
  if (variant === 'isotype') {
    return (
      <div className={`relative inline-flex items-center justify-center ${iconSizes[size]} ${className}`}>
        <img 
          src={logoUrl}
          alt="SaborAI Logo"
          className="w-full h-full object-contain drop-shadow-xs select-none transition-transform duration-200"
          loading="eager"
        />
      </div>
    );
  }

  // 2. Stacked (Icono arriba, texto abajo)
  if (variant === 'stacked') {
    return (
      <div className={`inline-flex flex-col items-center select-none gap-2 ${className}`}>
        <img 
          src={logoUrl}
          alt="SaborAI Logo"
          className={`${iconSizes[size]} object-contain drop-shadow-xs transition-transform duration-200`}
          loading="eager"
        />
        <div className="flex items-center gap-1.5">
          <span className={`font-black tracking-tight text-stone-900 ${textSizes[size]}`}>
            Sabor<span className="text-[#588157]">AI</span>
          </span>
          <span className={`rounded-md bg-stone-900 text-[#a9b994] font-black uppercase tracking-wider ${badgeSizes[size]}`}>
            POS
          </span>
        </div>
      </div>
    );
  }

  // 3. Full / Wordmark (Icono oficial + Tipografía SaborAI POS en línea)
  return (
    <div className={`inline-flex items-center select-none gap-2.5 ${className}`}>
      <div className={`relative flex items-center justify-center ${iconSizes[size]} shrink-0`}>
        <img 
          src={logoUrl}
          alt="SaborAI Logo"
          className="w-full h-full object-contain drop-shadow-xs transition-transform duration-200"
          loading="eager"
        />
      </div>
      <div className="flex flex-col text-left leading-tight">
        <div className="flex items-center gap-1.5">
          <span className={`font-black tracking-tight text-stone-900 ${textSizes[size]}`}>
            Sabor<span className="text-[#588157]">AI</span>
          </span>
          <span className={`rounded-md bg-stone-900 text-[#a9b994] font-black uppercase tracking-wider ${badgeSizes[size]}`}>
            POS
          </span>
        </div>
        {size !== 'sm' && (
          <span className="text-[10px] font-semibold text-stone-400 tracking-wide uppercase">
            Gastronomía Inteligente
          </span>
        )}
      </div>
    </div>
  );
};
