# Traslado atómico de productos y revisiones CAS

## Qué se encontró

El checkout no tenía una acción de traslado server-side: el cliente enviaba dos `UPDATE_TABLE` separados para origen y destino. Además, cada actualización de orden reemplazaba sus líneas; una respuesta de red perdida podía provocar un retry con otro ID y una copia antigua podía volver a introducir o borrar productos.

## Qué quedó integrado localmente

En la rama local, `POST /api/offline/sync` ahora enruta `UPDATE_TABLE` a `sync_pos_table_order` y `TRANSFER_TABLE_ITEM` a `transfer_pos_order_item`. El traslado es una única acción del cliente con un `operationId` estable. La RPC propuesta bloquea mesas y órdenes en un orden consistente, compara las dos revisiones esperadas y mueve la línea completa o parcial, incrementa ambas revisiones y registra el ledger/auditoría dentro de una transacción.

La metadata de esquema consultada confirmó que producción tiene `pos_cash_registers` y `pos_terminals`, pero `pos_orders` aún no tiene `cash_register_id` ni `terminal_id`. La propuesta se ajustó para agregar ambos campos nullable e idempotentes con FKs a esas tablas, y para validar tenant/sucursal/caja/turno/terminal dentro de la RPC sin depender de un trigger Phase 9 posiblemente pendiente. El preflight exige las tablas base y Phase 8; Phase 9 podrá aplicarse después y sus `ADD COLUMN IF NOT EXISTS` no duplicarán esos campos. Solo se consultó `information_schema`, no filas de operación.

Los guardados normales incluyen `cloudRevision` y los IDs estables de cada línea. La RPC propuesta compara la revisión antes de reemplazar artículos, guarda el nuevo número y usa un ledger idempotente para un retry con el mismo ID y payload. La cola offline conserva el ID de operación, solo encadena revisiones de operaciones que aún no se enviaron, no rebasa automáticamente requests de resultado ambiguo y marca conflictos CAS como atención requerida; bloquea las acciones posteriores de las comandas afectadas. Los cambios de estado hechos por el flujo existente de pago incrementarían la revisión mediante un trigger propuesto.

## Límite operativo importante

**La nube aún no ofrece esta garantía.** El endpoint y cliente locales llaman a `sync_pos_table_order` y `transfer_pos_order_item`, pero esas funciones no existen en la base hasta aplicar la propuesta SQL. No afirmo que el traslado o el CAS estén activos, ni que esta rama deba desplegarse antes de revisar y aprobar la SQL.

Además, el POS no lee actualmente `pos_orders` para rehidratar comandas activas: usa snapshots locales y los comparte por Realtime entre dispositivos conectados. Una instalación con un snapshot antiguo o sin `cloudRevision` enviará revisión 0; el CAS rechazará el guardado en vez de sobrescribir la nube, pero no existe todavía una ruta de lectura/reconciliación automática para recuperar ese estado. Ese caso queda visible como conflicto y necesita conciliación antes de reintentar.

El cierre del flujo de pago existente queda cubierto por el trigger de revisión diseñado, pero el pipeline de pago continúa siendo una secuencia de operaciones API separadas. Esta propuesta no lo convierte en una transacción atómica de pago.

## SQL propuesto, no aplicado

[`atomic-order-item-transfer.sql`](../../supabase/proposals/atomic-order-item-transfer.sql) está fuera de `supabase/migrations`. Incluye columna de revisión, trigger de cambios de estado, ledger para guardados normales, RPC de actualización CAS y RPC transaccional de traslado. No se ejecutó ni se conectó a Supabase.

La prueba PostgreSQL [`atomic-order-item-transfer.integration.sql`](../../supabase/proposals/atomic-order-item-transfer.integration.sql) está preparada para una base desechable. Cubre traslado parcial, rollback ante fallo entre la reducción de origen y la inserción de destino, replay sin duplicados, guardado obsoleto tras un traslado, dos escritores con la misma revisión, idempotencia de guardado, revisión de ambos lados y cambio de estado. **No se ejecutó**, porque no hay PostgreSQL local desechable disponible y no se usaron credenciales ni datos reales.

## Validación y siguientes límites

La suite local de pruebas y el build deben validar el código cliente/endpoint; además, los tests unitarios ejercitan el encadenamiento de revisiones de la cola. Eso no sustituye ejecutar la prueba SQL en una base desechable ni aplicar la migración con aprobación.

No se aplicó SQL, no se usaron secretos ni datos reales, y no se hizo push, merge ni despliegue. Antes de habilitar esto en un entorno, hay que revisar/aprobar la propuesta, ejecutar la prueba de integración contra PostgreSQL desechable y después planificar la migración con la aprobación correspondiente.
