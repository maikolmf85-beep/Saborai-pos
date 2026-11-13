export const isValidHaciendaActivityCode = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;

  const code = value.trim();
  return /^\d{4}\.\d$/.test(code) || /^\d{6}$/.test(code);
};
