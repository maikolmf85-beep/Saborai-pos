import type { MenuItem, Table, UserProfile } from '../types';

export interface NyzaActionContext {
  tenantId: string;
  currentUser: Pick<UserProfile, 'role'> | null;
  menuItems: MenuItem[];
  selectedTable: Table | null;
  tables: Table[];
  zones: string[];
}

export type NyzaActionValidation =
  | { ok: true; command: Record<string, unknown> }
  | { ok: false; reason: string };

const ADMIN_ONLY = 'Esta acción requiere un usuario administrador.';
const MAX_ACTION_SNAPSHOT_LENGTH = 100_000;
const TOOL_ALLOWLIST = new Set([
  'tool_restart_spooler',
  'tool_reroute_printer',
  'tool_db_integrity_check',
  'tool_check_dgt_status',
  'tool_enable_contingency_mode',
  'tool_run_daily_learning',
  'tool_teach_heuristic'
]);
const VALID_CATEGORIES = new Set([
  'HARDWARE_RESILIENCE',
  'DGT_TAX_INTELLIGENCE',
  'KITCHEN_SPEED',
  'FINANCIAL_VELOCITY',
  'SYSTEM_HYGIENE'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  const hasControlCharacter = Array.from(result).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!result || result.length > maxLength || hasControlCharacter) return null;
  return result;
}

function allowedRole(context: NyzaActionContext, roles: string[]): boolean {
  return Boolean(context.currentUser && roles.includes(context.currentUser.role));
}

function adminOnly(context: NyzaActionContext): NyzaActionValidation | null {
  return context.currentUser?.role === 'ADMIN' ? null : { ok: false, reason: ADMIN_ONLY };
}

function findUniqueMenuItem(menu: MenuItem[], name: unknown): MenuItem | null {
  const exactName = cleanString(name, 120);
  if (!exactName) return null;
  const matches = menu.filter(item => item.name.trim().toLocaleLowerCase() === exactName.toLocaleLowerCase());
  return matches.length === 1 ? matches[0] : null;
}

export function getNyzaMenuSnapshot(item: MenuItem): string {
  return JSON.stringify({
    id: item.id,
    name: item.name,
    price: item.price,
    available: item.available,
    ingredients: item.ingredients.map(ingredient => ({
      name: ingredient.name,
      currentStock: ingredient.currentStock,
      requiredQty: ingredient.requiredQty,
      unit: ingredient.unit
    })),
    modifiers: (item.modifiers || []).map(modifier => ({
      id: modifier.id,
      name: modifier.name,
      isRequired: modifier.isRequired,
      multiple: modifier.multiple,
      choices: modifier.choices.map(choice => ({ name: choice.name, extraPrice: choice.extraPrice ?? 0 }))
    }))
  });
}

export function getNyzaTableSnapshot(table: Table): string {
  return JSON.stringify({
    id: table.id,
    name: table.name,
    zone: table.zone,
    status: table.status,
    orderNumber: table.activeOrder?.orderNumber || null,
    items: (table.activeOrder?.items || []).map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: item.selectedModifiers || []
    }))
  });
}

function normalizeModifiers(item: MenuItem, rawModifiers: unknown):
  | { ok: true; modifiers: Array<{ modifierName: string; choiceName: string; extraPrice: number }> }
  | { ok: false; reason: string } {
  if (rawModifiers === undefined || rawModifiers === null) rawModifiers = [];
  if (!Array.isArray(rawModifiers) || rawModifiers.length > 10) {
    return { ok: false, reason: 'Las opciones del platillo no tienen un formato válido.' };
  }

  const selected: Array<{ modifierName: string; choiceName: string; extraPrice: number }> = [];
  const counts = new Map<string, number>();
  const seen = new Set<string>();

  for (const rawModifier of rawModifiers) {
    if (!isRecord(rawModifier)) return { ok: false, reason: 'Una opción del platillo no tiene un formato válido.' };
    const modifierName = cleanString(rawModifier.modifierName, 80);
    const choiceName = cleanString(rawModifier.choiceName, 80);
    if (!modifierName || !choiceName) return { ok: false, reason: 'Una opción del platillo está incompleta.' };

    const modifier = item.modifiers?.find(candidate => candidate.name.trim().toLocaleLowerCase() === modifierName.toLocaleLowerCase());
    if (!modifier) return { ok: false, reason: `La opción “${modifierName}” no existe para “${item.name}”.` };
    const choice = modifier.choices.find(candidate => candidate.name.trim().toLocaleLowerCase() === choiceName.toLocaleLowerCase());
    if (!choice) return { ok: false, reason: `“${choiceName}” no es una opción válida de “${modifier.name}”.` };

    const key = `${modifier.id}:${choice.name.toLocaleLowerCase()}`;
    if (seen.has(key)) return { ok: false, reason: `La opción “${choice.name}” aparece repetida.` };
    seen.add(key);
    counts.set(modifier.id, (counts.get(modifier.id) || 0) + 1);
    const configuredPrice = choice.extraPrice ?? 0;
    if (!Number.isFinite(configuredPrice) || configuredPrice < 0) {
      return { ok: false, reason: `El precio configurado para “${choice.name}” no es válido.` };
    }
    selected.push({ modifierName: modifier.name, choiceName: choice.name, extraPrice: configuredPrice });
  }

  for (const modifier of item.modifiers || []) {
    const count = counts.get(modifier.id) || 0;
    if (modifier.isRequired && count === 0) {
      return { ok: false, reason: `Falta elegir una opción obligatoria de “${modifier.name}”.` };
    }
    if (!modifier.multiple && count > 1) {
      return { ok: false, reason: `“${modifier.name}” solo permite una opción.` };
    }
  }

  return { ok: true, modifiers: selected };
}

function normalizeTools(rawTools: unknown): NyzaActionValidation {
  if (!Array.isArray(rawTools) || rawTools.length < 1 || rawTools.length > 3) {
    return { ok: false, reason: 'La lista de herramientas debe contener entre 1 y 3 acciones.' };
  }

  const tools: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  for (const rawTool of rawTools) {
    if (!isRecord(rawTool) || typeof rawTool.name !== 'string' || !TOOL_ALLOWLIST.has(rawTool.name)) {
      return { ok: false, reason: 'Nyza solicitó una herramienta que no está autorizada.' };
    }
    const rawParams = isRecord(rawTool.parameters) ? rawTool.parameters : {};
    const parameters: Record<string, unknown> = {};

    if (rawTool.name === 'tool_reroute_printer') {
      const failedIp = cleanString(rawParams.failed_ip, 80);
      const backupIp = cleanString(rawParams.backup_ip, 80);
      if (!failedIp || !backupIp) return { ok: false, reason: 'El cambio de impresora necesita origen y respaldo explícitos.' };
      parameters.failed_ip = failedIp;
      parameters.backup_ip = backupIp;
    } else if (rawTool.name === 'tool_enable_contingency_mode') {
      if (rawParams.reason_code !== undefined && rawParams.reason_code !== '02') {
        return { ok: false, reason: 'Nyza no puede cambiar la clave de contingencia solicitada.' };
      }
      parameters.reason_code = '02';
    } else if (rawTool.name === 'tool_teach_heuristic') {
      const category = cleanString(rawParams.category, 50);
      const title = cleanString(rawParams.title, 120);
      const rule = cleanString(rawParams.rule, 1200);
      if (!category || !VALID_CATEGORIES.has(category) || !title || !rule) {
        return { ok: false, reason: 'La regla que Nyza propone guardar está incompleta o no es válida.' };
      }
      parameters.category = category;
      parameters.title = title;
      parameters.rule = rule;
    }

    tools.push({ name: rawTool.name, parameters });
  }

  return { ok: true, command: { type: 'TOOL_CALLS', tool_calls: tools } };
}

/** Valida las acciones aprobadas por el usuario contra el estado POS actual. */
export function validateNyzaAction(raw: unknown, context: NyzaActionContext): NyzaActionValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'La acción de Nyza no tiene un formato válido.' };
  const hasExpectedTenantId = Object.prototype.hasOwnProperty.call(raw, '__nyzaExpectedTenantId');
  const expectedTenantId = cleanString(raw.__nyzaExpectedTenantId, 120);
  if (hasExpectedTenantId && !expectedTenantId) {
    return { ok: false, reason: 'No se pudo verificar el restaurante de la vista previa. Vuelve a solicitar la acción.' };
  }
  if (expectedTenantId && expectedTenantId !== context.tenantId) {
    return { ok: false, reason: 'El restaurante activo cambió desde que se mostró la acción. Vuelve a solicitarla y revísala en el negocio actual.' };
  }
  const rawType = String(raw.type || raw.action || '').toUpperCase();
  const params = isRecord(raw.params) ? raw.params : isRecord(raw.arguments) ? raw.arguments : raw;

  if (rawType === 'CREATE_TABLE' || rawType === 'CREATETABLE') {
    const denied = adminOnly(context);
    if (denied) return denied;
    const salonName = cleanString(params.salonName ?? params.salon, 60);
    const tableNumber = Number(params.tableNumber ?? params.number);
    if (!salonName || !Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 500) {
      return { ok: false, reason: 'La mesa o el salón solicitado no son válidos.' };
    }
    if (!context.zones.some(zone => zone.toLocaleLowerCase() === salonName.toLocaleLowerCase())) {
      return { ok: false, reason: `El salón “${salonName}” no existe. Crea o elige primero un salón configurado.` };
    }
    if (context.tables.some(table => table.number === tableNumber)) {
      return { ok: false, reason: `La mesa ${tableNumber} ya existe.` };
    }
    return { ok: true, command: { type: 'CREATE_TABLE', params: { salonName, tableNumber } } };
  }

  if (rawType === 'NAVIGATE_TO' || rawType === 'NAVIGATETO') {
    const view = String(params.view || '').toLowerCase();
    if (!['tables', 'billing', 'kds', 'menu'].includes(view)) return { ok: false, reason: 'La sección solicitada no es válida.' };
    if (view === 'menu' && context.currentUser?.role !== 'ADMIN') return { ok: false, reason: 'La sección de menú requiere un usuario administrador.' };
    return { ok: true, command: { type: 'NAVIGATE_TO', params: { view } } };
  }

  if (['OPEN_CASH_REGISTER', 'OPENCASHREGISTER', 'OPEN_SHIFT'].includes(rawType)) {
    if (!allowedRole(context, ['ADMIN', 'CAJERO', 'SALONERO_CAJA'])) {
      return { ok: false, reason: 'Tu rol no puede abrir o administrar el turno de caja.' };
    }
    return { ok: true, command: { type: 'OPEN_SHIFT' } };
  }

  if (rawType === 'ADD_ITEM') {
    if (!allowedRole(context, ['ADMIN', 'SALONERO', 'SALONERO_CAJA', 'WAITER'])) {
      return { ok: false, reason: 'Tu rol no puede agregar productos a una comanda.' };
    }
    if (!context.selectedTable || !context.tables.some(table => table.id === context.selectedTable?.id)) {
      return { ok: false, reason: 'Selecciona una mesa existente antes de agregar un producto.' };
    }
    const expectedTableId = cleanString(raw.__nyzaExpectedTableId ?? params.tableId, 120);
    if (expectedTableId && expectedTableId !== context.selectedTable.id) {
      return { ok: false, reason: 'La mesa seleccionada cambió desde la vista previa. Vuelve a pedir la acción y revísala de nuevo.' };
    }
    const currentTable = context.tables.find(table => table.id === context.selectedTable?.id);
    const hasExpectedTableSnapshot = Object.prototype.hasOwnProperty.call(raw, '__nyzaExpectedTableSnapshot');
    if (expectedTenantId && !hasExpectedTableSnapshot) {
      return { ok: false, reason: 'La vista previa no incluyó una validación de mesa. Vuelve a solicitar la acción.' };
    }
    const expectedTableSnapshot = hasExpectedTableSnapshot
      ? cleanString(raw.__nyzaExpectedTableSnapshot, MAX_ACTION_SNAPSHOT_LENGTH)
      : null;
    if (hasExpectedTableSnapshot && !expectedTableSnapshot) {
      return { ok: false, reason: 'La vista previa de la mesa excede el límite de verificación. Vuelve a solicitar la acción.' };
    }
    if (currentTable && expectedTableSnapshot && expectedTableSnapshot !== getNyzaTableSnapshot(currentTable)) {
      return { ok: false, reason: 'El estado de la mesa o de su comanda cambió desde la vista previa. Revisa la acción de nuevo.' };
    }
    if (currentTable?.status === 'RESERVED' || currentTable?.status === 'PRE_CHECK') {
      return { ok: false, reason: 'No se puede agregar un producto a una mesa reservada o que está cerrando la cuenta.' };
    }
    const item = findUniqueMenuItem(context.menuItems, params.product);
    if (!item) return { ok: false, reason: 'El producto debe coincidir exactamente con un nombre único del menú actual.' };
    const hasExpectedMenuSnapshot = Object.prototype.hasOwnProperty.call(raw, '__nyzaExpectedMenuSnapshot');
    if (expectedTenantId && !hasExpectedMenuSnapshot) {
      return { ok: false, reason: 'La vista previa no incluyó una validación del producto. Vuelve a solicitar la acción.' };
    }
    const expectedMenuSnapshot = hasExpectedMenuSnapshot
      ? cleanString(raw.__nyzaExpectedMenuSnapshot, MAX_ACTION_SNAPSHOT_LENGTH)
      : null;
    if (hasExpectedMenuSnapshot && !expectedMenuSnapshot) {
      return { ok: false, reason: 'La vista previa del producto excede el límite de verificación. Vuelve a solicitar la acción.' };
    }
    if (expectedMenuSnapshot && expectedMenuSnapshot !== getNyzaMenuSnapshot(item)) {
      return { ok: false, reason: 'El precio, disponibilidad o las opciones del producto cambiaron desde la vista previa. Vuelve a solicitar la acción.' };
    }
    if (item.available === false) return { ok: false, reason: `“${item.name}” está marcado como no disponible.` };
    if (!Number.isFinite(item.price) || item.price < 0) return { ok: false, reason: `El precio configurado de “${item.name}” no es válido.` };
    const quantity = params.quantity === undefined ? 1 : Number(params.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { ok: false, reason: 'La cantidad debe ser un número entero entre 1 y 50.' };
    }
    const modifierResult = normalizeModifiers(item, params.modifiers);
    if (!modifierResult.ok) return modifierResult;
    return {
      ok: true,
      command: {
        type: 'ADD_ITEM',
        product: item.name,
        quantity,
        modifiers: modifierResult.modifiers,
        tableId: context.selectedTable.id
      }
    };
  }

  if (rawType === 'ADD_ZONE') {
    const denied = adminOnly(context);
    if (denied) return denied;
    const name = cleanString(params.name, 50);
    if (!name) return { ok: false, reason: 'El nombre del salón no es válido.' };
    if (context.zones.some(zone => zone.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return { ok: false, reason: `El salón “${name}” ya existe.` };
    }
    return { ok: true, command: { type: 'ADD_ZONE', name } };
  }

  if (rawType === 'OPEN_REPORTS') {
    if (context.currentUser?.role !== 'ADMIN') return { ok: false, reason: 'Los reportes requieren un usuario administrador.' };
    const range = String(params.range || 'today');
    if (!['today', 'week', 'month'].includes(range)) return { ok: false, reason: 'El periodo del reporte no es válido.' };
    return { ok: true, command: { type: 'OPEN_REPORTS', range } };
  }

  if (['ADD_TABLE_RANGE', 'ADD_TABLES', 'CREATE_TABLES'].includes(rawType)) {
    const denied = adminOnly(context);
    if (denied) return denied;
    const zone = cleanString(params.zone, 60);
    const from = Number(params.from ?? params.start ?? params.startNumber);
    const to = Number(params.to ?? params.end ?? params.endNumber);
    const seats = Number(params.seats ?? 2);
    if (!zone || !context.zones.some(candidate => candidate.toLocaleLowerCase() === zone.toLocaleLowerCase())) {
      return { ok: false, reason: 'El rango debe usar un salón que ya exista.' };
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from >= 50) {
      return { ok: false, reason: 'El rango debe contener entre 1 y 50 números de mesa válidos.' };
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) return { ok: false, reason: 'La capacidad debe ser un entero entre 1 y 30.' };
    const duplicate = context.tables.find(table => table.number >= from && table.number <= to);
    if (duplicate) return { ok: false, reason: `La mesa ${duplicate.number} ya existe; no se creó ningún rango.` };
    return { ok: true, command: { type: 'ADD_TABLE_RANGE', zone, from, to, seats } };
  }

  if (rawType === 'ADD_TABLE') {
    const denied = adminOnly(context);
    if (denied) return denied;
    const name = cleanString(params.name, 50);
    const zone = cleanString(params.zone, 60);
    const seats = Number(params.seats ?? 4);
    const match = name?.match(/^(?:mesa\s*)?(\d{1,3})$/i);
    const number = match ? Number(match[1]) : NaN;
    if (!match || !Number.isInteger(number) || number < 1 || number > 500) return { ok: false, reason: 'Indica un número de mesa entre 1 y 500.' };
    if (!zone || !context.zones.some(candidate => candidate.toLocaleLowerCase() === zone.toLocaleLowerCase())) {
      return { ok: false, reason: 'El salón solicitado debe existir en la configuración.' };
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) return { ok: false, reason: 'La capacidad debe ser un entero entre 1 y 30.' };
    if (context.tables.some(table => table.number === number)) return { ok: false, reason: `La mesa ${number} ya existe.` };
    return { ok: true, command: { type: 'ADD_TABLE', name: `Mesa ${number}`, zone, seats } };
  }

  if (rawType === 'TOGGLE_DISH_AVAILABILITY') {
    const denied = adminOnly(context);
    if (denied) return denied;
    const item = findUniqueMenuItem(context.menuItems, params.product);
    if (!item) return { ok: false, reason: 'El platillo debe coincidir exactamente con un nombre único del menú actual.' };
    if (typeof params.available !== 'boolean') return { ok: false, reason: 'El estado de disponibilidad debe ser verdadero o falso.' };
    const hasExpectedMenuSnapshot = Object.prototype.hasOwnProperty.call(raw, '__nyzaExpectedMenuSnapshot');
    if (expectedTenantId && !hasExpectedMenuSnapshot) {
      return { ok: false, reason: 'La vista previa no incluyó una validación del producto. Vuelve a solicitar la acción.' };
    }
    const expectedMenuSnapshot = hasExpectedMenuSnapshot
      ? cleanString(raw.__nyzaExpectedMenuSnapshot, MAX_ACTION_SNAPSHOT_LENGTH)
      : null;
    if (hasExpectedMenuSnapshot && !expectedMenuSnapshot) {
      return { ok: false, reason: 'La vista previa del producto excede el límite de verificación. Vuelve a solicitar la acción.' };
    }
    if (expectedMenuSnapshot && expectedMenuSnapshot !== getNyzaMenuSnapshot(item)) {
      return { ok: false, reason: 'El estado del producto cambió desde la vista previa. Vuelve a solicitar la acción.' };
    }
    if (item.available === params.available) return { ok: false, reason: 'El producto ya tiene ese estado de disponibilidad.' };
    return { ok: true, command: { type: 'TOGGLE_DISH_AVAILABILITY', product: item.name, available: params.available } };
  }

  if (rawType === 'TOOL_CALLS' || Array.isArray(raw.tool_calls)) {
    const denied = adminOnly(context);
    if (denied) return denied;
    return normalizeTools(raw.tool_calls);
  }

  if (rawType === 'OPEN_LEARNING_HUB' || rawType === 'NYZA_HUB') {
    return { ok: true, command: { type: 'OPEN_LEARNING_HUB' } };
  }

  if (rawType === 'AUTO_REPAIR') {
    return { ok: false, reason: 'La reparación automática no está implementada ni verificada; Nyza no ejecutó ninguna reparación.' };
  }

  return { ok: false, reason: 'Esta acción no está reconocida o no está autorizada.' };
}

/** Texto de vista previa; se muestra como texto normal, nunca como HTML. */
export function describeNyzaAction(
  raw: unknown,
  context?: Pick<NyzaActionContext, 'menuItems' | 'selectedTable'>
): string {
  if (!isRecord(raw)) return 'Acción de formato desconocido';
  const type = String(raw.type || raw.action || 'desconocida').toUpperCase();
  const params = isRecord(raw.params) ? raw.params : isRecord(raw.arguments) ? raw.arguments : raw;
  const safe = (value: unknown, max = 100) => {
    const printable = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
    return cleanString(printable, max) || 'sin detalle';
  };

  if (type === 'ADD_ITEM') {
    const item = context?.menuItems ? findUniqueMenuItem(context.menuItems, params.product) : null;
    const quantity = Number.isInteger(Number(params.quantity)) && Number(params.quantity) > 0 ? Number(params.quantity) : 1;
    const selectedModifiers = Array.isArray(params.modifiers) ? params.modifiers.filter(isRecord) : [];
    const modifierLabel = selectedModifiers.map(modifier => `${safe(modifier.modifierName, 80)}: ${safe(modifier.choiceName, 80)}`).join(', ');
    const trustedExtras = item
      ? selectedModifiers.reduce((sum, selection) => {
          const modifier = item.modifiers?.find(candidate => candidate.name.toLocaleLowerCase() === String(selection.modifierName || '').trim().toLocaleLowerCase());
          const choice = modifier?.choices.find(candidate => candidate.name.toLocaleLowerCase() === String(selection.choiceName || '').trim().toLocaleLowerCase());
          return sum + (choice && Number.isFinite(choice.extraPrice) ? (choice.extraPrice ?? 0) : 0);
        }, 0)
      : 0;
    const tableName = context?.selectedTable?.name || 'mesa seleccionada';
    const price = item && Number.isFinite(item.price) ? item.price + trustedExtras : null;
    const priceLabel = price === null ? 'precio sujeto a validación' : `₡${(price * quantity).toLocaleString('es-CR')} total`;
    return `Agregar ${quantity} × ${safe(item?.name || params.product)}${modifierLabel ? ` (${modifierLabel})` : ''} a ${tableName}; ${priceLabel}`;
  }
  if (type === 'CREATE_TABLE' || type === 'CREATETABLE') return `Crear mesa ${safe(params.tableNumber ?? params.number)} en ${safe(params.salonName ?? params.salon)}`;
  if (type === 'ADD_TABLE_RANGE' || type === 'ADD_TABLES' || type === 'CREATE_TABLES') return `Crear mesas ${safe(params.from ?? params.start)}–${safe(params.to ?? params.end)} en ${safe(params.zone)} (${safe(params.seats)} personas)`;
  if (type === 'ADD_TABLE') return `Crear ${safe(params.name)} en ${safe(params.zone)}`;
  if (type === 'ADD_ZONE') return `Agregar el salón “${safe(params.name)}”`;
  if (type === 'TOGGLE_DISH_AVAILABILITY') return `${params.available === false ? 'Marcar no disponible' : 'Marcar disponible'}: ${safe(params.product)}`;
  if (type === 'OPEN_REPORTS') return `Abrir reportes (${safe(params.range || 'today')})`;
  if (type === 'OPEN_SHIFT' || type === 'OPEN_CASH_REGISTER' || type === 'OPENCASHREGISTER') return 'Abrir el control de turno y caja';
  if (type === 'NAVIGATE_TO' || type === 'NAVIGATETO') return `Abrir la sección ${safe(params.view)}`;
  if (type === 'OPEN_LEARNING_HUB' || type === 'NYZA_HUB') return 'Abrir las reglas y notas locales de Nyza';
  if (type === 'TOOL_CALLS' || Array.isArray(raw.tool_calls)) {
    const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
    const labels: Record<string, string> = {
      tool_restart_spooler: 'recargar configuración de impresoras',
      tool_reroute_printer: 'cambiar ruta de impresora',
      tool_db_integrity_check: 'leer cola local pendiente (sin verificar integridad total)',
      tool_check_dgt_status: 'consultar disponibilidad de Hacienda',
      tool_enable_contingency_mode: 'guardar modo local de contingencia 02 (sin emitir factura)',
      tool_run_daily_learning: 'crear un resumen local sin entrenar el modelo',
      tool_teach_heuristic: 'guardar una nota local'
    };
    const details = calls.slice(0, 3).map(call => {
      if (!isRecord(call)) return 'acción no reconocida';
      const name = safe(call.name, 60);
      const params = isRecord(call.parameters) ? call.parameters : {};
      return `${labels[String(call.name)] || name}${Object.keys(params).length ? ` ${JSON.stringify(params).slice(0, 220)}` : ''}`;
    });
    return `Ejecutar herramienta(s) de diagnóstico: ${details.join('; ')}`;
  }
  return `Acción no reconocida: ${safe(type, 60)}`;
}
