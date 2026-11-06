-- SaborAI POS - FK tenant-scoped de impresoras asignadas (fase 2 de 2).
-- Dependencias: 20261106203000_pos_tenant_printer_registry.sql y sus dependencias
-- pos_core, phase8_central_cash_registers y phase2_cash_control_sync.
--
-- Antes de aplicar:
--   1. Aplicar la fase 1.
--   2. Desplegar el flujo ADMIN que registra impresoras locales en pos_printers.
--   3. Ejecutar la sincronización por tenant para las impresoras ya asignadas.
--   4. Revisar este preflight de solo lectura; el resultado esperado es 0:
--
-- SELECT count(*) AS asignaciones_sin_impresora_del_mismo_tenant
-- FROM public.pos_cash_registers r
-- LEFT JOIN public.pos_printers p
--   ON p.tenant_id = r.tenant_id AND p.id = r.assigned_printer_id
-- WHERE r.assigned_printer_id IS NOT NULL AND p.id IS NULL;
--
-- La migración vuelve a comprobar la condición y aborta sin validar la FK si
-- encuentra un valor huérfano o una referencia de otro tenant. No borra ni
-- reasigna datos existentes.

DO $$
DECLARE
  orphan_count bigint;
  assigned_type text;
BEGIN
  IF to_regclass('public.pos_cash_registers') IS NULL
     OR to_regclass('public.pos_printers') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42P01',
      MESSAGE = 'Faltan pos_cash_registers o pos_printers. Aplica primero 20261106203000_pos_tenant_printer_registry.sql.';
  END IF;

  SELECT data_type INTO assigned_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
    AND column_name = 'assigned_printer_id';
  IF assigned_type <> 'text' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42804',
      MESSAGE = 'pos_cash_registers.assigned_printer_id debe ser text después de la fase 1.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.pos_printers'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indimmediate
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY key.ordinality)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        WHERE key.ordinality <= i.indnkeyatts
      ) = ARRAY['tenant_id', 'id']::text[]
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42830',
      MESSAGE = 'pos_printers no tiene una clave única inmediata, válida y no parcial sobre (tenant_id, id), requerida por ON CONFLICT y la FK.';
  END IF;

  SELECT count(*) INTO orphan_count
  FROM public.pos_cash_registers r
  LEFT JOIN public.pos_printers p
    ON p.tenant_id = r.tenant_id AND p.id = r.assigned_printer_id
  WHERE r.assigned_printer_id IS NOT NULL AND p.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = format(
        'No se agregó la FK: hay %s cajas con impresora no registrada para el mismo tenant. Sincroniza el registro cloud por tenant y repite el preflight; no borres ni reasignes IDs para forzar la migración.',
        orphan_count
      );
  END IF;
END;
$$;

DO $$
DECLARE
  existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_definition
  FROM pg_constraint
  WHERE conrelid = 'public.pos_cash_registers'::regclass
    AND conname = 'pos_cash_registers_tenant_assigned_printer_fk';

  IF existing_definition IS NULL THEN
    ALTER TABLE public.pos_cash_registers
      ADD CONSTRAINT pos_cash_registers_tenant_assigned_printer_fk
      FOREIGN KEY (tenant_id, assigned_printer_id)
      REFERENCES public.pos_printers(tenant_id, id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
      NOT VALID;
  ELSIF position('foreign key (tenant_id, assigned_printer_id)' IN lower(existing_definition)) = 0
     OR position('pos_printers' IN lower(existing_definition)) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42710',
      MESSAGE = 'Ya existe pos_cash_registers_tenant_assigned_printer_fk con definición incompatible; no se cambió.';
  END IF;
END;
$$;

ALTER TABLE public.pos_cash_registers
  VALIDATE CONSTRAINT pos_cash_registers_tenant_assigned_printer_fk;

CREATE INDEX IF NOT EXISTS pos_printers_tenant_role_active_idx
  ON public.pos_printers(tenant_id, role, is_active);
