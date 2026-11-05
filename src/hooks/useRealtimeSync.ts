import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/supabaseClient';
import { Table, KDSOrder, MenuItem } from '../types';
import { canRespondToRealtimeSync, resolveRealtimeTablePayload } from '../services/tableSync';
import { resolveRealtimeTenantZones } from '../services/tenantZones';

function sendSyncRequest(channel: any) {
  void channel.send({ type: 'broadcast', event: 'request-sync', payload: {} });
}

export function useRealtimeSync(
  tenantId: string | undefined,
  tablesHydrated: boolean,
  onUpdateTables: (tables: Table[], skipBroadcast: boolean) => void,
  onUpdateKdsOrders: (orders: KDSOrder[], skipBroadcast: boolean) => void,
  onUpdateMenuItems: (items: MenuItem[], skipBroadcast: boolean) => void,
  onUpdateShifts: (shiftsMap: any, skipBroadcast: boolean) => void,
  onUpdateTenant: (tenant: any, skipBroadcast: boolean) => void,
  onUpdateStaff: (staff: any[], skipBroadcast: boolean) => void,
  getCurrentState: () => any
) {
  const channelRef = useRef<any>(null);

  // Keep references to the latest callbacks so we don't re-subscribe on every render
  const callbacksRef = useRef({ onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts, onUpdateTenant, onUpdateStaff, getCurrentState });
  const tablesHydratedRef = useRef(tablesHydrated);
  useEffect(() => {
    callbacksRef.current = { onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts, onUpdateTenant, onUpdateStaff, getCurrentState };
  }, [onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts, onUpdateTenant, onUpdateStaff, getCurrentState]);
  useEffect(() => {
    tablesHydratedRef.current = tablesHydrated;
  }, [tablesHydrated]);

  useEffect(() => {
    const client = supabaseClient;
    if (!tenantId || !client) return;

    const channelName = `tenant-${tenantId}-sync`;
    const channel = client.channel(channelName, {
      config: { private: true }
    });

    channel
      .on('broadcast', { event: 'sync-tables' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        if (String(currentState.tenant?.id) !== String(tenantId)) return;
        const localTables = currentState.tables || [];
        const resolved = resolveRealtimeTablePayload(localTables, payload, currentState.tablesHydrated === true);
        if (resolved) callbacksRef.current.onUpdateTables(resolved as Table[], true);
      })
      .on('broadcast', { event: 'sync-kds' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        const localKds = currentState.kdsOrders || [];
        
        if (!payload.orders || payload.orders.length === 0) return;
        
        const merged = [...localKds];
        payload.orders.forEach((incoming: any) => {
          const idx = merged.findIndex((o: any) => o.id === incoming.id);
          if (idx >= 0) {
            // Keep the one with the latest status if possible, but since we don't track timestamps per item state easily, just override.
            // However, don't overwrite a 'READY' or 'SERVED' with 'PENDING'
            const localStatus = merged[idx].status;
            if (incoming.status === 'PENDING' && (localStatus === 'READY' || localStatus === 'SERVED' || localStatus === 'IN_PREPARATION')) {
              // Ignore older status from incoming
            } else {
              merged[idx] = { ...merged[idx], ...incoming };
            }
          } else {
            merged.push(incoming);
          }
        });
        callbacksRef.current.onUpdateKdsOrders(merged, true);
      })
      .on('broadcast', { event: 'sync-menu' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        const localMenu = currentState.menuItems || [];
        
        if (!payload.menuItems || payload.menuItems.length === 0) return;
        
        const merged = [...localMenu];
        payload.menuItems.forEach((incoming: any) => {
          const idx = merged.findIndex((i: any) => i.id === incoming.id);
          if (idx >= 0) {
            merged[idx] = { ...merged[idx], ...incoming };
            if (!incoming.modifiers && localMenu[idx].modifiers) {
              merged[idx].modifiers = localMenu[idx].modifiers;
            }
          } else {
            merged.push(incoming);
          }
        });
        callbacksRef.current.onUpdateMenuItems(merged, true);
      })
      .on('broadcast', { event: 'sync-shifts' }, ({ payload }) => {
        callbacksRef.current.onUpdateShifts(payload.shiftsMap, true);
      })
      .on('broadcast', { event: 'sync-tenant' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        if (String(currentState.tenant?.id) !== String(tenantId) || String(payload?.tenant?.id) !== String(tenantId)) return;
        const zones = resolveRealtimeTenantZones(
          payload.tenant.zones,
          currentState.tenant?.zones,
          payload.snapshot === true,
          Boolean(currentState.hasLocalData)
        );
          
        // Merge menuCategories
        const localCats = currentState.tenant?.menuCategories || [];
        const incomingCats = payload.tenant?.menuCategories || [];
        const mergedCats = Array.from(new Set([...localCats, ...incomingCats]));
          
        const mergedTenant = {
          ...payload.tenant,
          zones,
          menuCategories: mergedCats
        };
          
        callbacksRef.current.onUpdateTenant(mergedTenant, true);
      })
      .on('broadcast', { event: 'sync-staff' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        // Don't let an empty staff list overwrite a populated one unless we explicitly want to
        if (payload.staff && payload.staff.length > 0 || (currentState.staff?.length === 0)) {
          callbacksRef.current.onUpdateStaff(payload.staff, true);
        }
      })
      .on('broadcast', { event: 'request-sync' }, () => {
        const state = callbacksRef.current.getCurrentState();
        if (canRespondToRealtimeSync(state)) {
          // Prevent broadcasting if this is a fresh/demo instance with no real data
          const isFreshDemo = state.tenant?.id?.startsWith('tenant_demo_') && (!state.staff || state.staff.length === 0) && (!state.tables || state.tables.length === 0) && (!state.menuItems || state.menuItems.length === 0);
          if (isFreshDemo) {
            console.log('Skipping broadcast of fresh demo state to avoid overwriting network.');
            return;
          }

          channel.send({ type: 'broadcast', event: 'sync-shifts', payload: { shiftsMap: state.shiftsMap } });
          channel.send({ type: 'broadcast', event: 'sync-tables', payload: { tables: state.tables, snapshot: true, tablesHydrated: true } });
          channel.send({ type: 'broadcast', event: 'sync-kds', payload: { orders: state.kdsOrders } });
          channel.send({ type: 'broadcast', event: 'sync-menu', payload: { menuItems: state.menuItems } });
          channel.send({ type: 'broadcast', event: 'sync-tenant', payload: { tenant: state.tenant, snapshot: true } });
          const safeStaff = (state.staff || []).map((member: any) => {
            const { pin: _pin, ...safeMember } = member;
            return safeMember;
          });
          channel.send({ type: 'broadcast', event: 'sync-staff', payload: { staff: safeStaff } });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Connected to realtime channel: ${channelName}`);
          if (tablesHydratedRef.current) sendSyncRequest(channel);
        }
      });

    channelRef.current = channel;

    return () => {
      client.removeChannel(channel);
    };
  }, [tenantId]); // Only re-subscribe if tenantId changes

  // If the channel connected before IndexedDB/auth hydration finished, request
  // another exchange now that this client can safely apply table snapshots.
  useEffect(() => {
    if (!tenantId || !tablesHydrated) return;
    const channel = channelRef.current;
    if (channel) sendSyncRequest(channel);
  }, [tenantId, tablesHydrated]);

  // Expose broadcast functions
  const broadcastTables = (newTables: Table[]) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-tables',
        payload: { tables: newTables, snapshot: true, tablesHydrated },
      });
    }
  };

  const broadcastKdsOrders = (newOrders: KDSOrder[]) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-kds',
        payload: { orders: newOrders },
      });
    }
  };

  const broadcastMenuItems = (newMenu: MenuItem[]) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-menu',
        payload: { menuItems: newMenu },
      });
    }
  };

  const broadcastShifts = (shiftsMap: any) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-shifts',
        payload: { shiftsMap },
      });
    }
  };

  const broadcastTenant = (tenant: any) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-tenant',
        payload: { tenant },
      });
    }
  };

  const broadcastStaff = (staff: any[]) => {
    if (channelRef.current) {
      const safeStaff = (staff || []).map(member => {
        const { pin: _pin, ...safeMember } = member;
        return safeMember;
      });
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-staff',
        payload: { staff: safeStaff },
      });
    }
  };

  return { broadcastTables, broadcastKdsOrders, broadcastMenuItems, broadcastShifts, broadcastTenant, broadcastStaff };
}
