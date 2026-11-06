-- SaborAI POS - Registro cloud de impresoras por tenant (fase 1 de 2).
-- Esta migración crea el registro de identidad para validar asignaciones.
-- La configuración de conexión (IP, Bluetooth, USB y demás hardware) continúa
-- en el almacenamiento local por dispositivo; esta tabla solo contiene
-- identidad, nombre, rol y estado operativo.
--
-- Dependencias versionadas:
--   20261017000000_pos_core.sql
--   20261026000000_phase8_central_cash_registers.sql
--   20261026010000_phase2_cash_control_sync.sql
--
-- Orden de despliegue previsto:
--   1. Aplicar esta migración.
--   2. Desplegar el endpoint que registra impresoras con tenant derivado de sesión.
--   3. Sincronizar las impresoras locales de cada tenant que ya tenga una caja asignada.
--   4. Aplicar 20261106204000_pos_tenant_printer_assignment_fk.sql, cuyo preflight
--      aborta si queda alguna asignación sin una impresora del mismo tenant.
--
-- Preflight de solo lectura recomendado antes de aplicar:
--   SELECT count(*) AS cajas_con_impresora_asignada
--   FROM public.pos_cash_registers
--   WHERE assigned_printer_id IS NOT NULL;
-- Este paso conserva esas referencias y las convierte a texto; la segunda fase
-- exige que cada ID se haya registrado bajo el tenant de su caja.

DO $$
DECLARE
  assigned_type text;
BEGIN
  IF to_regclass('public.pos_branches') IS NULL
     OR to_regclass('public.pos_cash_registers') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42P01',
      MESSAGE = 'Faltan las tablas base pos_branches/pos_cash_registers. Aplica primero 20261017000000_pos_core.sql.';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
         AND column_name = 'tenant_id' AND data_type = 'uuid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
         AND column_name = 'assigned_printer_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
         AND column_name = 'branch_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
         AND column_name = 'legacy_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
         AND column_name = 'source_device_key'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42703',
      MESSAGE = 'Faltan columnas de Fase 2/Fase 8 requeridas por la sincronización de cajas. Aplica 20261026000000_phase8_central_cash_registers.sql y 20261026010000_phase2_cash_control_sync.sql.';
  END IF;

  SELECT data_type INTO assigned_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
    AND column_name = 'assigned_printer_id';
  IF assigned_type NOT IN ('uuid', 'text') THEN
    RAISE EXCEPTION USING
      ERRCODE = '42804',
      MESSAGE = format('pos_cash_registers.assigned_printer_id debe ser uuid o text; tipo encontrado: %s.', assigned_type);
  END IF;

  IF to_regclass('public.pos_printers') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('tenant_id', 'uuid', NULL::integer),
        ('id', 'string', 200),
        ('name', 'string', 120),
        ('role', 'string', 6),
        ('is_active', 'boolean', NULL::integer),
        ('updated_at', 'timestamp with time zone', NULL::integer)
      ) AS required(column_name, expected_type, minimum_length)
      LEFT JOIN information_schema.columns c
        ON c.table_schema = 'public'
       AND c.table_name = 'pos_printers'
       AND c.column_name = required.column_name
      WHERE c.column_name IS NULL
         OR (required.expected_type = 'string' AND c.data_type NOT IN ('text', 'character varying'))
         OR (required.expected_type <> 'string' AND c.data_type <> required.expected_type)
         OR (required.minimum_length IS NOT NULL
             AND c.character_maximum_length IS NOT NULL
             AND c.character_maximum_length < required.minimum_length)
         OR (required.column_name IN ('tenant_id', 'id', 'name', 'role', 'is_active', 'updated_at')
             AND c.is_nullable <> 'NO')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42804',
        MESSAGE = 'Ya existe public.pos_printers con columnas, tipos o nulabilidad incompatibles. Se requieren tenant_id uuid, id/name/role text (o varchar con longitud suficiente), is_active boolean y updated_at timestamptz, todos NOT NULL; no se modificó.';
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
        MESSAGE = 'Ya existe public.pos_printers sin una clave única inmediata, válida y no parcial sobre (tenant_id, id), requerida por ON CONFLICT; no se modificó.';
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pos_printers (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_printers_tenant_id_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT pos_printers_id_nonempty_ck CHECK (char_length(btrim(id)) BETWEEN 1 AND 200),
  CONSTRAINT pos_printers_name_nonempty_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT pos_printers_role_ck CHECK (role IN ('caja', 'cocina', 'bar'))
);

-- PrinterConfig.id es un string local; versiones existentes usan tanto UUIDs
-- como IDs como "prn_<timestamp>". Guardarlos como texto evita inventar IDs.
DO $$
DECLARE
  assigned_type text;
BEGIN
  SELECT data_type INTO assigned_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pos_cash_registers'
    AND column_name = 'assigned_printer_id';
  IF assigned_type = 'uuid' THEN
    ALTER TABLE public.pos_cash_registers
      ALTER COLUMN assigned_printer_id TYPE text
      USING assigned_printer_id::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pos_cash_registers'::regclass
      AND conname = 'pos_cash_registers_assigned_printer_id_text_ck'
  ) THEN
    ALTER TABLE public.pos_cash_registers
      ADD CONSTRAINT pos_cash_registers_assigned_printer_id_text_ck
      CHECK (assigned_printer_id IS NULL OR char_length(btrim(assigned_printer_id)) BETWEEN 1 AND 200)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.pos_cash_registers
  VALIDATE CONSTRAINT pos_cash_registers_assigned_printer_id_text_ck;

CREATE INDEX IF NOT EXISTS pos_cash_registers_tenant_assigned_printer_idx
  ON public.pos_cash_registers(tenant_id, assigned_printer_id)
  WHERE assigned_printer_id IS NOT NULL;

ALTER TABLE public.pos_printers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_printers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pos_printers TO service_role;

COMMENT ON TABLE public.pos_printers IS
  'Registro de impresoras del tenant para validar assigned_printer_id; la configuración de hardware permanece local por dispositivo.';
COMMENT ON COLUMN public.pos_cash_registers.assigned_printer_id IS
  'ID de PrinterConfig validado contra pos_printers por (tenant_id, id).';
