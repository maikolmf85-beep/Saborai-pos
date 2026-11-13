import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface HaciendaBranchConfig {
  environment: 'sandbox' | 'production';
  atvUsername?: string;
  atvPassword?: string;
  pinP12?: string;
  p12Base64?: string;
  p12FileName?: string;
  cedulaEmisor?: string;
  tipoIdentificacion?: '01' | '02' | '03' | '04';
  codigoActividad?: string;
  provincia?: string;
  canton?: string;
  distrito?: string;
  otrasSenas?: string;
  proveedorSistemas?: string;
  sucursal?: string;
  terminal?: string;
  certExpiresOn?: string;
  isValidated?: boolean;
  lastTestedAt?: string;
}

export interface EncryptedHaciendaConfig {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const PUBLIC_CONFIG_FIELDS = [
  'environment', 'p12FileName', 'cedulaEmisor', 'tipoIdentificacion',
  'codigoActividad', 'provincia', 'canton', 'distrito', 'otrasSenas',
  'proveedorSistemas', 'sucursal', 'terminal', 'certExpiresOn',
  'isValidated', 'lastTestedAt'
] as const;

export function normalizeHaciendaBranchCode(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  return raw.padStart(3, '0');
}

function getEncryptionKey(): Buffer {
  const value = process.env.HACIENDA_CONFIG_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('HACIENDA_CONFIG_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  }
  return Buffer.from(value, 'hex');
}

function configAad(tenantId: string, branchCode: string): Buffer {
  return Buffer.from(`saborai:hacienda:v1:${tenantId}:${branchCode}`, 'utf8');
}

export function encryptHaciendaConfig(
  config: HaciendaBranchConfig,
  tenantId: string,
  branchCode: string
): EncryptedHaciendaConfig {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  cipher.setAAD(configAad(tenantId, branchCode));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(config), 'utf8'),
    cipher.final()
  ]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

export function decryptHaciendaConfig(
  encrypted: EncryptedHaciendaConfig,
  tenantId: string,
  branchCode: string
): HaciendaBranchConfig {
  if (!encrypted || encrypted.version !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.ciphertext) {
    throw new Error('Invalid encrypted Hacienda configuration envelope.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(encrypted.iv, 'base64')
  );
  decipher.setAAD(configAad(tenantId, branchCode));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const parsed = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Hacienda configuration payload.');
  }
  return parsed as HaciendaBranchConfig;
}

export function mergeHaciendaConfig(
  existing: HaciendaBranchConfig | null,
  input: unknown,
  options: { removeCertificate?: boolean; clearAtvCredentials?: boolean } = {}
): HaciendaBranchConfig {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const previous = existing || { environment: 'sandbox' as const };
  const readString = (key: string, fallback = ''): string =>
    typeof source[key] === 'string' ? source[key] as string : fallback;
  const next: HaciendaBranchConfig = {
    environment: source.environment === 'production' ? 'production' : 'sandbox',
    atvUsername: options.clearAtvCredentials ? '' : (readString('atvUsername') || previous.atvUsername || '').trim(),
    atvPassword: options.clearAtvCredentials
      ? ''
      : (typeof source.atvPassword === 'string' && source.atvPassword.length > 0
        ? source.atvPassword
        : previous.atvPassword || ''),
    pinP12: options.removeCertificate
      ? ''
      : (typeof source.pinP12 === 'string' && source.pinP12.length > 0
        ? source.pinP12
        : previous.pinP12 || ''),
    p12Base64: options.removeCertificate
      ? ''
      : (typeof source.p12Base64 === 'string' && source.p12Base64.length > 0
        ? source.p12Base64
        : previous.p12Base64 || ''),
    p12FileName: options.removeCertificate
      ? ''
      : (readString('p12FileName') || previous.p12FileName || ''),
    cedulaEmisor: readString('cedulaEmisor', previous.cedulaEmisor || '').trim(),
    tipoIdentificacion: ['01', '02', '03', '04'].includes(readString('tipoIdentificacion', previous.tipoIdentificacion || '02'))
      ? readString('tipoIdentificacion', previous.tipoIdentificacion || '02') as HaciendaBranchConfig['tipoIdentificacion']
      : '02',
    codigoActividad: readString('codigoActividad', previous.codigoActividad || '').trim(),
    provincia: readString('provincia', previous.provincia || '').trim(),
    canton: readString('canton', previous.canton || '').trim(),
    distrito: readString('distrito', previous.distrito || '').trim(),
    otrasSenas: readString('otrasSenas', previous.otrasSenas || '').trim(),
    proveedorSistemas: readString('proveedorSistemas', previous.proveedorSistemas || '').replace(/\D/g, ''),
    sucursal: readString('sucursal', previous.sucursal || '').replace(/\D/g, '').padStart(3, '0').slice(-3),
    terminal: readString('terminal', previous.terminal || '').replace(/\D/g, '').padStart(5, '0').slice(-5),
    certExpiresOn: readString('certExpiresOn', previous.certExpiresOn || ''),
    isValidated: false,
    lastTestedAt: previous.lastTestedAt
  };
  if (!next.atvUsername && next.atvPassword) next.atvPassword = '';
  if (!next.p12Base64 && next.pinP12) next.pinP12 = '';
  const validationFields: Array<keyof HaciendaBranchConfig> = [
    'environment', 'atvUsername', 'atvPassword', 'pinP12', 'p12Base64',
    'cedulaEmisor', 'tipoIdentificacion', 'codigoActividad', 'provincia',
    'canton', 'distrito', 'otrasSenas', 'proveedorSistemas', 'sucursal', 'terminal'
  ];
  const profileUnchanged = Boolean(existing) && validationFields.every(key =>
    String(existing?.[key] ?? '') === String(next[key] ?? '')
  );
  next.isValidated = Boolean(existing?.isValidated && profileUnchanged);
  return next;
}

export function publicHaciendaConfig(config: HaciendaBranchConfig): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of PUBLIC_CONFIG_FIELDS) {
    const value = config[key as keyof HaciendaBranchConfig];
    if (value !== undefined) safe[key] = value;
  }
  const username = config.atvUsername || '';
  const maskedUsername = username.length > 6
    ? `${username.slice(0, 3)}•••${username.slice(-Math.min(8, username.length - 3))}`
    : (username ? '••••' : '');
  return {
    ...safe,
    atvUsernameConfigured: Boolean(config.atvUsername),
    atvUsernameMasked: maskedUsername,
    atvPasswordConfigured: Boolean(config.atvPassword),
    certificateConfigured: Boolean(config.p12Base64 && config.pinP12)
  };
}

export function hasHaciendaCredentials(config: HaciendaBranchConfig): boolean {
  return Boolean(config.atvUsername && config.atvPassword && config.p12Base64 && config.pinP12);
}
