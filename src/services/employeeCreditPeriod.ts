export type EmployeeCreditPeriod = 'day' | 'week' | 'month' | 'year';

export interface EmployeeCreditPeriodRange {
  from: string;
  to: string;
}

const BUSINESS_TIME_ZONE = 'America/Costa_Rica';
const COSTA_RICA_UTC_OFFSET_HOURS = 6;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function datePartsInBusinessZone(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return {
    year: parts.find(part => part.type === 'year')?.value || '2000',
    month: parts.find(part => part.type === 'month')?.value || '01',
    day: parts.find(part => part.type === 'day')?.value || '01'
  };
}

export function getCostaRicaDateInputValue(date = new Date()): string {
  const { year, month, day } = datePartsInBusinessZone(date);
  return `${year}-${month}-${day}`;
}

function makeBusinessMidnightUtc(year: number, monthIndex: number, day: number): Date {
  // POS uses Costa Rica business time (UTC-6); store/query timestamps remain UTC.
  return new Date(Date.UTC(year, monthIndex, day, COSTA_RICA_UTC_OFFSET_HOURS));
}

export function getEmployeeCreditPeriodRange(
  period: EmployeeCreditPeriod,
  referenceDate: string
): EmployeeCreditPeriodRange {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate);
  if (!match) throw new Error('Selecciona una fecha válida para el informe.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error('Selecciona una fecha válida para el informe.');
  }

  let start: Date;
  let end: Date;
  if (period === 'day') {
    start = makeBusinessMidnightUtc(year, month - 1, day);
    end = new Date(start.getTime() + DAY_IN_MS);
  } else if (period === 'week') {
    const mondayOffset = (calendarDate.getUTCDay() + 6) % 7;
    const monday = new Date(calendarDate.getTime() - mondayOffset * DAY_IN_MS);
    start = makeBusinessMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
    end = new Date(start.getTime() + 7 * DAY_IN_MS);
  } else if (period === 'month') {
    start = makeBusinessMidnightUtc(year, month - 1, 1);
    end = makeBusinessMidnightUtc(year, month, 1);
  } else {
    start = makeBusinessMidnightUtc(year, 0, 1);
    end = makeBusinessMidnightUtc(year + 1, 0, 1);
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

export function formatEmployeeCreditPeriodRange(range: EmployeeCreditPeriodRange): string {
  const from = new Date(range.from);
  const through = new Date(new Date(range.to).getTime() - 1);
  const dateFormatter = new Intl.DateTimeFormat('es-CR', {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: 'medium'
  });
  if (Number.isNaN(from.getTime()) || Number.isNaN(through.getTime())) return 'Periodo seleccionado';
  const first = dateFormatter.format(from);
  const last = dateFormatter.format(through);
  return first === last ? first : `${first} – ${last}`;
}
