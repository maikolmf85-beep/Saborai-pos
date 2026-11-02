export interface DinerNameItem {
  dinerName?: string | null;
}

const PLACEHOLDER_DINER_NAME = /^(?:cuenta\s+\d+(?:\s*\(comensal\s+\d+\))?|general|para\s+llevar|mesa)$/i;

/** Returns a trimmed diner name while omitting generic account labels. */
export function getDisplayableDinerName(value?: string | null): string | undefined {
  const name = value?.trim();
  if (!name || PLACEHOLDER_DINER_NAME.test(name)) return undefined;
  return name;
}

/** Returns distinct diner names in first-seen order, ignoring case-only duplicates. */
export function getDinerNames(
  items: readonly DinerNameItem[],
  fallbackName?: string | null
): string[] {
  const preferredName = getDisplayableDinerName(fallbackName);
  const candidates = preferredName
    ? [preferredName]
    : items.map(item => getDisplayableDinerName(item.dinerName)).filter((name): name is string => Boolean(name));
  const uniqueNames = new Map<string, string>();

  for (const name of candidates) {
    const normalizedName = name.toLocaleLowerCase('es-CR');
    if (!uniqueNames.has(normalizedName)) uniqueNames.set(normalizedName, name);
  }

  return [...uniqueNames.values()];
}

/** Formats the distinct diner names represented by a receipt or kitchen order. */
export function formatDinerNames(
  items: readonly DinerNameItem[],
  fallbackName?: string | null
): string | undefined {
  const names = getDinerNames(items, fallbackName);
  if (names.length === 0) return undefined;

  return `${names.length === 1 ? 'Comensal' : 'Comensales'}: ${names.join(', ')}`;
}

/** Escape user-provided text before inserting it into a printer HTML document. */
export function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
