import React from 'react';

export interface CashRegisterIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
}

export const CashRegisterIcon: React.FC<CashRegisterIconProps> = ({
  size = 24,
  strokeWidth = 2,
  className = '',
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Base gaveta de dinero */}
      <rect x="4" y="16" width="16" height="5" rx="1" />
      <path d="M11 18.5h2" />

      {/* Cuerpo de la caja registradora */}
      <path d="M5 16l2-9h10l2 9" />

      {/* Visor / Pantalla de monto superior */}
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />

      {/* Botones y teclado numérico */}
      <path d="M9 11h.01" />
      <path d="M12 11h.01" />
      <path d="M15 11h.01" />
      <path d="M9 14h.01" />
      <path d="M12 14h.01" />
      <path d="M15 14h.01" />
    </svg>
  );
};

export const CashRegister = CashRegisterIcon;
export default CashRegisterIcon;
