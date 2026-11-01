# Propuesta pendiente: traslado atómico entre comandas

## Hallazgo

No existe en el checkout una acción de traslado server-side ni una RPC que actualice ambas comandas. El handler actual de `UPDATE_TABLE` llama secuencialmente a `pos_tables.upsert`, actualiza `pos_orders`, elimina y vuelve a insertar `pos_order_items`, y escribe el evento de auditoría al final. Cada request de origen y destino es independiente; no comparte transacción.

El código de traslado actual llama a `UPDATE_TABLE` dos veces con operation IDs generados por separado. Si se pierde la respuesta después de que una escritura se haya confirmado, el cliente puede encolar otra operación con otro ID. La cola offline también genera un ID nuevo al encolar, por lo que no puede deduplicar con certeza ese resultado ambiguo. En consecuencia, el comportamiento actual **no es atómico en la nube** y no se debe integrar, desplegar ni presentar como atómico.

## Propuesta SQL

El archivo [`atomic-order-item-transfer.sql`](../../supabase/proposals/atomic-order-item-transfer.sql) es una propuesta, fuera de `supabase/migrations`; no se ha aplicado ni ejecutado contra Supabase.

Incluye una columna `client_item_id` para conservar el ID de la línea que usa el POS, un índice único por orden y una tabla de idempotencia. La RPC `transfer_pos_order_item`:

- valida tenant, comandas activas, mesas distintas de la misma sucursal, snapshot vigente y cantidad;
- bloquea las mesas y comandas antes de modificar líneas;
- mueve una línea completa actualizando su `order_id`, o una cantidad parcial reduciendo origen e insertando destino;
- guarda resultado, ledger idempotente y auditoría dentro de la misma transacción PostgreSQL;
- devuelve el mismo resultado ante el mismo `operation_id`; rechaza reutilizarlo con otro actor o payload;
- resuelve líneas antiguas sin `client_item_id` solo si el snapshot coincide exactamente con una fila; si la coincidencia es ambigua o está desactualizada, rechaza sin modificar datos.

## Contrato que debe integrarse después de aprobar

El endpoint existente `POST /api/offline/sync` deberá admitir una única acción `TRANSFER_TABLE_ITEM` y delegar en una llamada a `supabaseAdmin.rpc('transfer_pos_order_item', ...)`. La autorización debe reutilizar la sesión, el actor y el permiso de actualización de mesas; para esta acción, el endpoint no debe tratar el evento de auditoría genérico como sustituto del ledger de la RPC.

Payload propuesto:

```ts
type TransferTableItemPayload = {
  sourceOrderNumber: string;
  destinationOrderNumber: string;
  sourceClientItemId: string;
  destinationClientItemId: string; // igual al origen si es traslado completo; nuevo si es parcial
  quantity: number;
  sourceItemSnapshot: TableItem;
};
```

El cliente debe generar un único `operationId` antes de llamar al endpoint y reutilizarlo exactamente al persistir/reintentar la acción offline. Eso requiere ampliar `OfflineSyncQueueItem.action` y `enqueueOfflineAction` para aceptar ese ID, además de persistir `item.id` como `client_item_id` en las sincronizaciones ordinarias. El traslado no debe volver a llamar `UPDATE_TABLE` por separado para origen y destino.

La cola puede guardar el traslado como una sola acción mientras no hay conexión; eso no significa que la nube ya lo haya aplicado. Una vez que el servidor recibe la operación, el commit del movimiento, el ledger y la auditoría es único. La integración debe conservar errores de validación/conflicto en la cola local y distinguirlos de fallos reintentables para evitar reintentos inútiles; nunca debe borrar la acción sin confirmación server-side.

## Pruebas preparadas

[`atomic-order-item-transfer.integration.sql`](../../supabase/proposals/atomic-order-item-transfer.integration.sql) es una prueba de integración para una base desechable después de aprobar y aplicar la propuesta. Verifica un traslado parcial, replay idempotente, rechazo de payload diferente con la misma clave y un fallo inyectado después de reducir la cantidad origen pero antes de insertar destino; luego comprueba rollback total y que reintentar la misma clave produce un solo movimiento.

La prueba SQL aún no se ejecutó: este entorno no tiene `psql` ni una instancia PostgreSQL/Supabase disponible. No se usaron credenciales ni datos reales. La única prueba ejecutable ahora es un test estático de contrato que valida los elementos esenciales del borrador; no sustituye la prueba PostgreSQL.

## Decisión pendiente

Se necesita aprobación antes de convertir el archivo en una migración activa o aplicar SQL. Después de aprobar, el siguiente cambio debe integrar endpoint, cola offline y cliente como una sola acción server-side; hasta entonces, la rama actual sigue teniendo dos escrituras `UPDATE_TABLE` y no ofrece atomicidad en la nube.
