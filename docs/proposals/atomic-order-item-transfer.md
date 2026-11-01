# Traslado atómico de productos y revisión de comandas

## Qué cambió en esta candidata

La rama local fue rebasada sobre la base de producción `3bebcf6ea390ab5096b3fae04e2855748381f18f`, conservando el ajuste de Nyza. La ruta local de sincronización ahora contempla una sola operación de traslado y acciones idempotentes de apertura/cierre de turnos. No hubo push, merge, despliegue ni aplicación de SQL.

El traslado llama a una sola RPC propuesta, con ID de operación estable, control CAS sobre las dos comandas y ledger/auditoría dentro de una transacción. La cola conserva el mismo ID en reintentos, ordena apertura → operaciones → cierre mediante secuencia estable y evita reintentar a ciegas acciones dependientes después de conflictos.

## Turno, caja y zonas

La UI transmite el ID del turno activo. La candidata sincroniza apertura y cierre como acciones separadas, guarda el `linked_zones` que estaba vigente al abrir y resuelve los IDs locales de turno/caja a sus registros cloud. La RPC de traslado propuesta bloquea caja y turno, exige que el turno siga `OPEN`, comprueba tenant/sucursal y permite el destino únicamente si su zona coincide exactamente con una zona cubierta. Una lista vacía conserva la semántica existente de “sin restricción de zona”. El guardado normal también valida que el turno asociado siga abierto.

El cierre se autoriza en el endpoint usando el rol persistido de la sesión: responsable de apertura o un rol con override (`ADMIN`, `CAJERO` o `SALONERO_CAJA`). La RPC de turno usa ledger idempotente; la cola mantiene apertura/cierre en orden y bloquea los pedidos relacionados ante un error terminal.

## Estado de preparación y revisiones

La RPC de `UPDATE_TABLE` ya no fuerza `pos_orders.status = 'OPEN'`; conserva `SENT`, `IN_PREPARATION`, `READY` y los demás estados que ya existan. Solo los cambios reales de estado incrementan `cloud_revision` mediante el trigger, y los cambios de contenido suben la revisión una vez dentro de la RPC, sin doble incremento por el mismo guardado.

La metadata consultada confirmó que producción tiene cajas y terminales, mientras `pos_orders` aún carece de `cash_register_id` y `terminal_id`. La SQL propuesta añade estas columnas nullable e idempotentes, además de revisar/declarar las dependencias de `legacy_id` y `linked_zones`; no consulta ni modifica filas existentes salvo DDL y no se ha ejecutado.

## Límite pendiente

**La nube aún no ofrece esta garantía: estas reglas todavía no están activas.** El endpoint local llama a RPCs que no existen en producción hasta que se revise y apruebe esta versión exacta de la SQL. La SQL cambió desde la versión aprobada anteriormente; requiere una nueva aprobación explícita antes de cualquier aplicación. Se deja fuera de `supabase/migrations` y no se ejecutó contra Supabase.

El POS todavía no rehidrata comandas activas desde `pos_orders`. Un dispositivo sin `cloudRevision` o con snapshot obsoleto puede enviar revisión 0; el CAS lo rechazará de forma segura, pero no hay una lectura/reconciliación automática de la comanda remota. El usuario deberá conciliar/actualizar el estado antes de reintentar. Tampoco se convierte el pipeline de pago/inventario/factura en una única transacción; el cambio de estado de pago solo invalida snapshots mediante el trigger propuesto.

## SQL y pruebas

La propuesta [`atomic-order-item-transfer.sql`](../../supabase/proposals/atomic-order-item-transfer.sql) y el test [`atomic-order-item-transfer.integration.sql`](../../supabase/proposals/atomic-order-item-transfer.integration.sql) están fuera de migraciones activas. La prueba cubre apertura idempotente, destino fuera de zona, preservación de estado de cocina, rollback de traslado ante inserción fallida, replay sin duplicados, escritores CAS obsoletos, cierre de turno y rechazo de un nuevo traslado después del cierre. **La prueba SQL no se ejecutó ni se conectó a Supabase**: no hay PostgreSQL local desechable; no se usaron credenciales ni datos reales.

La suite, el typecheck, el build y el lint locales verifican cliente/endpoint y contratos; no sustituyen ejecutar el SQL de integración en una base desechable ni revisar la propuesta antes de aprobarla. El cambio permanece en una rama local basada en el SHA de producción y no se publicó.
