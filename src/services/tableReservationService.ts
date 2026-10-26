import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseClient } from '../lib/supabaseClient';
import { getTenantItem, setTenantItem } from './tenantStorage';
import type { TableReservation, TableReservationInput, TableReservationStatus } from '../types/tableReservation';

const TABLE = 'pos_table_reservations';
const CACHE_KEY = 'table_reservations';
const OUTBOX_KEY = 'table_reservations_outbox';
const ACTIVE_STATUSES: TableReservationStatus[] = ['CONFIRMED', 'ARRIVED', 'SEATED'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OutboxOperation =
  | { id: string; kind: 'upsert'; record: TableReservation }
  | { id: string; kind: 'delete' };

interface ReservationRow {
  id: string;
  tenant_id: string;
  table_id: string;
  table_name: string;
  zone: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  reserved_at: string;
  duration_minutes: number;
  party_size: number;
  status: TableReservationStatus;
  notes: string;
  arrived_at: string | null;
  seated_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

function makeUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // UUID v4 fallback for older browsers and embedded POS devices.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function readCache(tenantId: string): TableReservation[] {
  const value = getTenantItem<TableReservation[]>(CACHE_KEY, tenantId);
  return Array.isArray(value) ? value : [];
}

function readOutbox(tenantId: string): OutboxOperation[] {
  const value = getTenantItem<OutboxOperation[]>(OUTBOX_KEY, tenantId);
  return Array.isArray(value) ? value : [];
}

function writeCache(tenantId: string, reservations: TableReservation[]): void {
  setTenantItem(CACHE_KEY, reservations, tenantId);
}

function writeOutbox(tenantId: string, operations: OutboxOperation[]): void {
  setTenantItem(OUTBOX_KEY, operations, tenantId);
}

function toRow(reservation: TableReservation): ReservationRow {
  return {
    id: reservation.id,
    tenant_id: reservation.tenantId,
    table_id: reservation.tableId,
    table_name: reservation.tableName,
    zone: reservation.zone,
    customer_name: reservation.customerName,
    customer_phone: reservation.customerPhone,
    customer_email: reservation.customerEmail || null,
    reserved_at: reservation.reservedAt,
    duration_minutes: reservation.durationMinutes,
    party_size: reservation.partySize,
    status: reservation.status,
    notes: reservation.notes,
    arrived_at: reservation.arrivedAt || null,
    seated_at: reservation.seatedAt || null,
    created_at: reservation.createdAt,
    updated_at: reservation.updatedAt
  };
}

function fromRow(row: ReservationRow): TableReservation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tableId: row.table_id,
    tableName: row.table_name,
    zone: row.zone || '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email || undefined,
    reservedAt: row.reserved_at,
    durationMinutes: row.duration_minutes,
    partySize: row.party_size,
    status: row.status,
    notes: row.notes || '',
    arrivedAt: row.arrived_at,
    seatedAt: row.seated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function overlayPending(
  canonical: TableReservation[],
  operations: OutboxOperation[]
): TableReservation[] {
  const byId = new Map(canonical.map(item => [item.id, item]));
  operations.forEach(operation => {
    if (operation.kind === 'delete') byId.delete(operation.id);
    else byId.set(operation.id, operation.record);
  });
  return [...byId.values()].sort((a, b) => a.reservedAt.localeCompare(b.reservedAt));
}

function enqueue(tenantId: string, operation: OutboxOperation): void {
  const operations = readOutbox(tenantId).filter(item => item.id !== operation.id);
  operations.push(operation);
  writeOutbox(tenantId, operations);
}

function updateQueued(tenantId: string, operationId: string): void {
  writeOutbox(tenantId, readOutbox(tenantId).filter(item => item.id !== operationId));
}

function canUseDatabase(tenantId: string): boolean {
  return Boolean(supabaseClient && isUuid(tenantId));
}

async function pushOperation(tenantId: string, operation: OutboxOperation): Promise<boolean> {
  if (!supabaseClient || !isUuid(tenantId)) return false;
  try {
    const result = operation.kind === 'delete'
      ? await supabaseClient.from(TABLE).delete().eq('tenant_id', tenantId).eq('id', operation.id)
      : await supabaseClient.from(TABLE).upsert(toRow(operation.record), { onConflict: 'id' });
    if (result.error) return false;
    updateQueued(tenantId, operation.id);
    return true;
  } catch {
    return false;
  }
}

async function syncPending(tenantId: string): Promise<void> {
  if (!canUseDatabase(tenantId)) return;
  // Keep order: a later update/delete for an ID supersedes earlier queued writes.
  for (const operation of readOutbox(tenantId)) {
    const succeeded = await pushOperation(tenantId, operation);
    if (!succeeded) break;
  }
}

async function fetchCanonical(tenantId: string): Promise<TableReservation[] | null> {
  if (!supabaseClient || !isUuid(tenantId)) return null;
  try {
    const { data, error } = await supabaseClient
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('reserved_at', { ascending: true });
    if (error || !data) return null;
    return (data as unknown as ReservationRow[]).map(fromRow);
  } catch {
    return null;
  }
}

function applyMutationToCache(tenantId: string, reservation: TableReservation): void {
  const cache = readCache(tenantId).filter(item => item.id !== reservation.id);
  cache.push(reservation);
  writeCache(tenantId, cache);
}

export async function loadTableReservations(tenantId: string): Promise<TableReservation[]> {
  try {
    await syncPending(tenantId);
    const canonical = await fetchCanonical(tenantId);
    if (canonical) {
      const merged = overlayPending(canonical, readOutbox(tenantId));
      writeCache(tenantId, merged);
      return merged;
    }
    return overlayPending(readCache(tenantId), readOutbox(tenantId));
  } catch {
    return overlayPending(readCache(tenantId), readOutbox(tenantId));
  }
}

export async function createTableReservation(
  tenantId: string,
  input: TableReservationInput
): Promise<TableReservation> {
  const timestamp = nowIso();
  const reservation: TableReservation = {
    ...input,
    id: makeUuid(),
    tenantId,
    customerEmail: input.customerEmail?.trim() || undefined,
    status: input.status || 'CONFIRMED',
    notes: input.notes || '',
    arrivedAt: input.arrivedAt || null,
    seatedAt: input.seatedAt || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  applyMutationToCache(tenantId, reservation);
  enqueue(tenantId, { id: reservation.id, kind: 'upsert', record: reservation });
  if (await pushOperation(tenantId, { id: reservation.id, kind: 'upsert', record: reservation })) {
    const canonical = await fetchCanonical(tenantId);
    if (canonical) writeCache(tenantId, overlayPending(canonical, readOutbox(tenantId)));
  }
  return reservation;
}

export async function updateTableReservation(
  tenantId: string,
  reservation: TableReservation
): Promise<TableReservation> {
  const updated = { ...reservation, tenantId, updatedAt: nowIso() };
  applyMutationToCache(tenantId, updated);
  enqueue(tenantId, { id: updated.id, kind: 'upsert', record: updated });
  if (await pushOperation(tenantId, { id: updated.id, kind: 'upsert', record: updated })) {
    const canonical = await fetchCanonical(tenantId);
    if (canonical) writeCache(tenantId, overlayPending(canonical, readOutbox(tenantId)));
  }
  return updated;
}

export async function deleteTableReservation(tenantId: string, reservationId: string): Promise<void> {
  writeCache(tenantId, readCache(tenantId).filter(item => item.id !== reservationId));
  enqueue(tenantId, { id: reservationId, kind: 'delete' });
  await pushOperation(tenantId, { id: reservationId, kind: 'delete' });
}

export async function syncPendingTableReservations(tenantId: string): Promise<void> {
  await syncPending(tenantId);
}

export function hasPendingTableReservationSync(tenantId: string): boolean {
  return readOutbox(tenantId).length > 0;
}

export function subscribeToTableReservations(
  tenantId: string,
  onChange: () => void
): () => void {
  if (!supabaseClient || !isUuid(tenantId)) return () => undefined;
  let channel: RealtimeChannel | null = null;
  try {
    channel = supabaseClient
      .channel(`table-reservations:${tenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: TABLE,
        filter: `tenant_id=eq.${tenantId}`
      }, () => {
        void loadTableReservations(tenantId).then(() => onChange()).catch(() => onChange());
      })
      .subscribe();
  } catch {
    return () => undefined;
  }
  return () => {
    if (channel && supabaseClient) {
      try { void supabaseClient.removeChannel(channel); } catch {}
    }
  };
}

export const tableReservationService = {
  load: loadTableReservations,
  create: createTableReservation,
  update: updateTableReservation,
  delete: deleteTableReservation,
  syncPending: syncPendingTableReservations,
  hasPendingSync: hasPendingTableReservationSync,
  subscribe: subscribeToTableReservations,
  isUuid
};

export { ACTIVE_STATUSES };
