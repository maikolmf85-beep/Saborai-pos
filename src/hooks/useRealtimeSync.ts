import { useEffect, useRef } from 'react';
import { supabaseClient } from '../lib/supabaseClient';
import { Table, KDSOrder, MenuItem } from '../types';

export function useRealtimeSync(
  tenantId: string | undefined,
  onUpdateTables: (tables: Table[], skipBroadcast: boolean) => void,
  onUpdateKdsOrders: (orders: KDSOrder[], skipBroadcast: boolean) => void,
  onUpdateMenuItems: (items: MenuItem[], skipBroadcast: boolean) => void,
  onUpdateShifts: (shiftsMap: any, skipBroadcast: boolean) => void
) {
  const channelRef = useRef<any>(null);

  // Keep references to the latest callbacks so we don't re-subscribe on every render
  const callbacksRef = useRef({ onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts });
  useEffect(() => {
    callbacksRef.current = { onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts };
  }, [onUpdateTables, onUpdateKdsOrders, onUpdateMenuItems, onUpdateShifts]);

  useEffect(() => {
    if (!tenantId) return;

    const channelName = `tenant-${tenantId}-sync`;
    const channel = supabaseClient.channel(channelName);

    channel
      .on('broadcast', { event: 'sync-tables' }, ({ payload }) => {
        callbacksRef.current.onUpdateTables(payload.tables, true);
      })
      .on('broadcast', { event: 'sync-kds' }, ({ payload }) => {
        callbacksRef.current.onUpdateKdsOrders(payload.orders, true);
      })
      .on('broadcast', { event: 'sync-menu' }, ({ payload }) => {
        callbacksRef.current.onUpdateMenuItems(payload.menuItems, true);
      })
      .on('broadcast', { event: 'sync-shifts' }, ({ payload }) => {
        callbacksRef.current.onUpdateShifts(payload.shiftsMap, true);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Connected to realtime channel: ${channelName}`);
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

  return { broadcastTables, broadcastKdsOrders, broadcastMenuItems, broadcastShifts };
}
