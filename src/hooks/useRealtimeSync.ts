import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/supabaseClient';
import { Table, KDSOrder, MenuItem } from '../types';

export function useRealtimeSync(
  tenantId: string | undefined,
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
  useEffect(() => {
    callbacksRef.current = { onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts, onUpdateTenant, onUpdateStaff, getCurrentState };
  }, [onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts, onUpdateTenant, onUpdateStaff, getCurrentState]);

  useEffect(() => {
    if (!tenantId) return;

    const channelName = `tenant-${tenantId}-sync`;
    const channel = supabaseClient.channel(channelName);

    channel
      .on('broadcast', { event: 'sync-tables' }, ({ payload }) => {
        const currentState = callbacksRef.current.getCurrentState();
        const localTables = currentState.tables || [];
        
        if (!payload.tables || payload.tables.length === 0) return;
        
        const merged = [...localTables];
        payload.tables.forEach((incoming: any) => {
          const idx = merged.findIndex((t: any) => t.id === incoming.id);
          if (idx >= 0) {
            merged[idx] = { ...merged[idx], ...incoming };
          } else {
            merged.push(incoming);
          }
        });
        callbacksRef.current.onUpdateTables(merged, true);
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
        // Only accept tenant sync if we are in demo/empty, or if the incoming tenant has the same ID (to update settings)
        const currentState = callbacksRef.current.getCurrentState();
        if (currentState.tenant?.id === 'tnt_demo_123' || currentState.tenant?.id === payload.tenant.id) {
          // Merge zones to prevent stale devices from wiping newly created zones
          const localZones = currentState.tenant?.zones || [];
          const incomingZones = payload.tenant?.zones || [];
          const mergedZones = Array.from(new Set([...localZones, ...incomingZones]));
          
          // Merge menuCategories
          const localCats = currentState.tenant?.menuCategories || [];
          const incomingCats = payload.tenant?.menuCategories || [];
          const mergedCats = Array.from(new Set([...localCats, ...incomingCats]));
          
          const mergedTenant = {
            ...payload.tenant,
            zones: mergedZones,
            menuCategories: mergedCats
          };
          
          callbacksRef.current.onUpdateTenant(mergedTenant, true);
        }
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
        if (state && state.hasLocalData) {
          // Prevent broadcasting if this is a fresh/demo instance with no real data
          const isFreshDemo = state.tenant?.id === 'tnt_demo_123' && (!state.staff || state.staff.length === 0) && (!state.tables || state.tables.length === 0);
          if (isFreshDemo) {
            console.log('Skipping broadcast of fresh demo state to avoid overwriting network.');
            return;
          }

          channel.send({ type: 'broadcast', event: 'sync-shifts', payload: { shiftsMap: state.shiftsMap } });
          channel.send({ type: 'broadcast', event: 'sync-tables', payload: { tables: state.tables } });
          channel.send({ type: 'broadcast', event: 'sync-kds', payload: { orders: state.kdsOrders } });
          channel.send({ type: 'broadcast', event: 'sync-menu', payload: { menuItems: state.menuItems } });
          channel.send({ type: 'broadcast', event: 'sync-tenant', payload: { tenant: state.tenant } });
          channel.send({ type: 'broadcast', event: 'sync-staff', payload: { staff: state.staff } });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Connected to realtime channel: ${channelName}`);
          channel.send({ type: 'broadcast', event: 'request-sync', payload: {} });
        }
      });

    channelRef.current = channel;

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [tenantId]); // Only re-subscribe if tenantId changes

  // Expose broadcast functions
  const broadcastTables = (newTables: Table[]) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-tables',
        payload: { tables: newTables },
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
      channelRef.current.send({
        type: 'broadcast',
        event: 'sync-staff',
        payload: { staff },
      });
    }
  };

  return { broadcastTables, broadcastKdsOrders, broadcastMenuItems, broadcastShifts, broadcastTenant, broadcastStaff };
}
