export const TABLE_RESERVATION_STATUSES = [
  'CONFIRMED',
  'ARRIVED',
  'SEATED',
  'CANCELLED',
  'NO_SHOW'
] as const;

export type TableReservationStatus = typeof TABLE_RESERVATION_STATUSES[number];

export interface TableReservation {
  id: string;
  tenantId: string;
  tableId: string;
  tableName: string;
  zone: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  reservedAt: string;
  durationMinutes: number;
  partySize: number;
  status: TableReservationStatus;
  notes: string;
  arrivedAt?: string | null;
  seatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TableReservationInput = Pick<
  TableReservation,
  | 'tableId'
  | 'tableName'
  | 'zone'
  | 'customerName'
  | 'customerPhone'
  | 'reservedAt'
  | 'durationMinutes'
  | 'partySize'
> & {
  customerEmail?: string;
  status?: TableReservationStatus;
  notes?: string;
  arrivedAt?: string | null;
  seatedAt?: string | null;
};
