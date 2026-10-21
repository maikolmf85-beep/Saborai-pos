export type NyzaUIAction =
  | { type: 'CREATE_TABLE'; params: { salonName: string; tableNumber: number } }
  | { type: 'NAVIGATE_TO'; params: { view: 'tables' | 'billing' | 'kds' | 'menu' } }
  | { type: 'OPEN_CASH_REGISTER'; params?: Record<string, never> };

export interface NyzaUIAgentHandlers {
  createTable: (salonName: string, tableNumber: number) => void | Promise<void>;
  navigateTo: (view: 'tables' | 'billing' | 'kds' | 'menu') => void;
  openCashRegister: () => void;
}

const CURSOR_ID = 'nyza-virtual-cursor';

function targetSelector(action: NyzaUIAction): string {
  if (action.type === 'CREATE_TABLE') return '[data-nyza-target="create-table"]';
  if (action.type === 'OPEN_CASH_REGISTER') return '#nav-shift-btn';
  return {
    tables: '#nav-tab-pos',
    billing: '#nav-tab-billing',
    kds: '#nav-tab-kds',
    menu: '#nav-tab-menu'
  }[action.params.view];
}

function ensureCursor(): HTMLDivElement {
  const existing = document.getElementById(CURSOR_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const cursor = document.createElement('div');
  cursor.id = CURSOR_ID;
  cursor.setAttribute('aria-hidden', 'true');
  cursor.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'width:18px', 'height:18px',
    'margin-left:-9px', 'margin-top:-9px', 'z-index:2147483647',
    'pointer-events:none', 'border:2px solid #a9b994', 'border-radius:9999px',
    'background:rgba(169,185,148,.18)', 'box-shadow:0 0 0 5px rgba(169,185,148,.16), 0 0 18px rgba(169,185,148,.95)',
    'opacity:0', 'transform:scale(.7)', 'transition: left 420ms cubic-bezier(.22,1,.36,1), top 420ms cubic-bezier(.22,1,.36,1), opacity 180ms ease, transform 180ms ease'
  ].join(';');
  document.body.appendChild(cursor);
  return cursor;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function animateCursorTo(selector: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;

  const cursor = ensureCursor();
  const rect = target.getBoundingClientRect();
  cursor.style.left = `${rect.left + rect.width / 2}px`;
  cursor.style.top = `${rect.top + rect.height / 2}px`;
  cursor.style.opacity = '1';
  cursor.style.transform = 'scale(1)';
  await wait(460);
  cursor.style.transform = 'scale(1.28)';
  await wait(120);
}

async function hideCursor(): Promise<void> {
  if (typeof document === 'undefined') return;
  const cursor = document.getElementById(CURSOR_ID);
  if (cursor instanceof HTMLElement) {
    cursor.style.opacity = '0';
    cursor.style.transform = 'scale(.7)';
    await wait(180);
  }
}

function normalizeAction(action: unknown): NyzaUIAction | null {
  if (!action || typeof action !== 'object') return null;
  const candidate = action as Record<string, any>;
  const type = String(candidate.type || candidate.action || '').toUpperCase();
  const params = candidate.params || candidate.arguments || {};

  if (type === 'CREATE_TABLE' || type === 'CREATETABLE') {
    const tableNumber = Number(params.tableNumber ?? params.number);
    if (!Number.isFinite(tableNumber)) return null;
    return { type: 'CREATE_TABLE', params: { salonName: String(params.salonName ?? params.salon ?? 'Principal'), tableNumber } };
  }
  if (type === 'NAVIGATE_TO' || type === 'NAVIGATETO') {
    const view = String(params.view || '').toLowerCase();
    if (!['tables', 'billing', 'kds', 'menu'].includes(view)) return null;
    return { type: 'NAVIGATE_TO', params: { view: view as 'tables' | 'billing' | 'kds' | 'menu' } };
  }
  if (type === 'OPEN_CASH_REGISTER' || type === 'OPENCASHREGISTER' || type === 'OPEN_SHIFT') {
    return { type: 'OPEN_CASH_REGISTER' };
  }
  return null;
}

export const nyzaUIAgent = {
  normalizeAction,
  async execute(rawAction: unknown, handlers: NyzaUIAgentHandlers): Promise<boolean> {
    const action = normalizeAction(rawAction);
    if (!action) return false;

    if (action.type === 'NAVIGATE_TO') {
      await animateCursorTo(targetSelector(action));
      handlers.navigateTo(action.params.view);
      await hideCursor();
      return true;
    }
    if (action.type === 'OPEN_CASH_REGISTER') {
      await animateCursorTo(targetSelector(action));
      handlers.openCashRegister();
      await hideCursor();
      return true;
    }

    await animateCursorTo(targetSelector(action));
    await handlers.createTable(action.params.salonName, action.params.tableNumber);
    await hideCursor();
    return true;
  }
};

export default nyzaUIAgent;
