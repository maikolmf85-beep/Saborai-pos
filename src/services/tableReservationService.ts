import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseClient } from '../lib/supabaseClient';
import { getTenantItem, setTenantItem } from './tenantStorage';
import { currentServerWriteActor, writePosOperation, type ServerWriteActor } from './serverWriteService';
import type { TableReservation, TableReservationInput, TableReservationStatus } from '../types/tableReservation';

const TABLE = 'pos_table_reservations';
const CACHE_KEY = 'table_reservations';
const OUTBOX_KEY = 'table_reservations_outbox';
const ACTIVE_STATUSES: TableReservationStatus[] = ['CONFIRMED', 'ARRIVED', 'SEATED'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let lastOutboxTenantId: string | null = null;

type OutboxOperationBase = {
  id: string;
  operationId: string;
  actorUserId: string | null;
  actorEmployeeId: string | null;
};

type OutboxOperation =
  | (OutboxOperationBase & { kind: 'upsert'; record: TableReservation })
  | (OutboxOperationBase & { kind: 'delete' });

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
  lastOutboxTenantId = tenantId;
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
  const currentActor = currentServerWriteActor();
  const actor: ServerWriteActor | null = operation.actorUserId
    ? { actorUserId: operation.actorUserId, actorEmployeeId: operation.actorEmployeeId }
    : currentActor?.actorEmployeeId === null ? currentActor : null;
  if (!actor || !currentActor
    || actor.actorUserId !== currentActor.actorUserId
    || actor.actorEmployeeId !== currentActor.actorEmployeeId) return false;
  try {
    if (operation.kind === 'delete') {
      await writePosOperation('DELETE_TABLE_RESERVATION', tenantId, { reservationId: operation.id }, {
        operationId: operation.operationId || `reservation_delete_${operation.id}`,
        actor
      });
    } else {
      await writePosOperation('UPSERT_TABLE_RESERVATION', tenantId, { reservation: operation.record }, {
        operationId: operation.operationId || `reservation_upsert_${operation.id}_${operation.record.updatedAt}`,
        actor
      });
    }
    updateQueued(tenantId, operation.id);
    return true;
  } catch {
    return false;
  }
}

async function syncPending(tenantId: string): Promise<void> {
  if (!canUseDatabase(tenantId)) return;
  lastOutboxTenantId = tenantId;
  // Keep order: a later update/delete for an ID supersedes earlier queued writes.
  for (const operation of readOutbox(tenantId)) {
    const succeeded = await pushOperation(tenantId, operation);
    if (!succeeded) break;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (lastOutboxTenantId) void syncPending(lastOutboxTenantId);
  });
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

function createOutboxBase(
  tenantId: string,
  id: string,
  operationKind: 'upsert' | 'delete',
  updatedAt = nowIso()
): OutboxOperationBase {
  const actor = currentServerWriteActor();
  return {
    id,
    operationId: `reservation_${operationKind}_${tenantId}_${id}_${Date.parse(updatedAt) || Date.now()}`.slice(0, 160),
    actorUserId: actor?.actorUserId || null,
    actorEmployeeId: actor?.actorEmployeeId || null
  };
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
  const operation: OutboxOperation = { ...createOutboxBase(tenantId, reservation.id, 'upsert', reservation.updatedAt), kind: 'upsert', record: reservation };
  enqueue(tenantId, operation);
  if (await pushOperation(tenantId, operation)) {
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
  const operation: OutboxOperation = { ...createOutboxBase(tenantId, updated.id, 'upsert', updated.updatedAt), kind: 'upsert', record: updated };
  enqueue(tenantId, operation);
  if (await pushOperation(tenantId, operation)) {
    const canonical = await fetchCanonical(tenantId);
    if (canonical) writeCache(tenantId, overlayPending(canonical, readOutbox(tenantId)));
  }
  return updated;
}

export async function deleteTableReservation(tenantId: string, reservationId: string): Promise<void> {
  writeCache(tenantId, readCache(tenantId).filter(item => item.id !== reservationId));
  const operation: OutboxOperation = { ...createOutboxBase(tenantId, reservationId, 'delete'), kind: 'delete' };
  enqueue(tenantId, operation);
  await pushOperation(tenantId, operation);
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
