import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'wordmark' | 'stacked' | 'isotype';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'light' | 'mono' | 'web';
}

const BRAND_ASSETS = '/assets/logos/brand-refresh';
const ISOTYPE_URL = `${BRAND_ASSETS}/NewIsotipoprincipal.png`;
const LIGHT_ISOTYPE_URL = `${BRAND_ASSETS}/NewIsotiposecundario.png`;
const FULL_LOGO_URL = `${BRAND_ASSETS}/NewLogoPrincipal.png`;
const WHITE_LOGO_URL = `${BRAND_ASSETS}/NewLogoversionblanco.png`;
const MONO_LOGO_URL = `${BRAND_ASSETS}/NewLogoaunasolatinta.png`;
const STACKED_LOGO_URL = `${BRAND_ASSETS}/NewVersionSAIPOS.png`;

export const BrandLogo: React.FC<LogoProps> = ({
  className = '',
  variant = 'full',
  size = 'md',
  tone = 'default'
}) => {
  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20'
  };

  const fullLogoSizes = {
    sm: 'w-32 sm:w-40',
    md: 'w-44 sm:w-56',
    lg: 'w-56 sm:w-72',
    xl: 'w-72 sm:w-96'
  };

  const stackedLogoSizes = {
    sm: 'w-20 sm:w-24',
    md: 'w-28 sm:w-36',
    lg: 'w-36 sm:w-44',
    xl: 'w-48 sm:w-56'
  };

  const logoAlt = 'Saborai POS';

  if (variant === 'isotype') {
    return (
      <div className={`relative inline-flex items-center justify-center ${iconSizes[size]} ${className}`}>
        <img
          src={tone === 'light' ? LIGHT_ISOTYPE_URL : ISOTYPE_URL}
          alt={logoAlt}
          className="w-full h-full object-contain drop-shadow-xs select-none transition-transform duration-200"
          loading="eager"
        />
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <img
        src={STACKED_LOGO_URL}
        alt={logoAlt}
        className={`${stackedLogoSizes[size]} h-auto max-w-full object-contain select-none ${className}`}
        loading="eager"
      />
    );
  }

  if (variant === 'full' || variant === 'wordmark') {
    const logoUrl = tone === 'light' ? WHITE_LOGO_URL : tone === 'mono' ? MONO_LOGO_URL : FULL_LOGO_URL;
    return (
      <img
        src={logoUrl}
        alt={logoAlt}
        className={`${fullLogoSizes[size]} h-auto max-w-full object-contain select-none ${className}`}
        loading="eager"
      />
    );
  }

  return (
    <div className={`inline-flex items-center select-none gap-2.5 ${className}`}>
      <div className={`relative flex items-center justify-center ${iconSizes[size]} shrink-0`}>
        <img
          src={ISOTYPE_URL}
          alt={logoAlt}
          className="w-full h-full object-contain drop-shadow-xs transition-transform duration-200"
          loading="eager"
        />
      </div>
      <img
        src={tone === 'light' ? WHITE_LOGO_URL : tone === 'mono' ? MONO_LOGO_URL : FULL_LOGO_URL}
        alt={logoAlt}
        className="w-32 sm:w-40 h-auto object-contain select-none"
        loading="eager"
      />
    </div>
  );
};
