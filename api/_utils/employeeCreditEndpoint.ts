import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './supabase.js';
import { handleOptions, requireAuth, requireRole, setCorsHeaders } from './security.js';
import { ROLE_PERMISSIONS } from './rolePermissions.js';
import { recordEmployeeCreditTransaction } from './employeeCredit.js';
import { EmployeeCreditPeriodReportAccumulator } from './employeeCreditReport.js';

const READ_ROLES = ['ADMIN', 'CAJERO', 'SALONERO_CAJA'] as const;
const PERIOD_REPORT_PAGE_SIZE = 1000;
const MAX_PERIOD_REPORT_TRANSACTIONS = 50000;

function safeAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 999999999999.99) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function transactionType(value: unknown): 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID' {
  return value === 'PAYMENT' || value === 'ADJUSTMENT' || value === 'VOID' ? value : 'CHARGE';
}

function readPeriodRange(query: VercelRequest['query']): { from: string; to: string } | null {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  if (!from && !to) return null;
  if (!from || !to) throw new Error('El informe requiere fecha inicial y final.');

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const rangeLength = toDate.getTime() - fromDate.getTime();
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())
    || rangeLength <= 0 || rangeLength > 367 * 24 * 60 * 60 * 1000) {
    throw new Error('El rango de fechas del informe no es válido.');
  }
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

export async function handleEmployeeCreditRequest(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleOptions(req, res)) return;
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Método no permitido.' });

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!auth.tenantId) return res.status(403).json({ error: 'La sesión no tiene un tenant asociado.' });

  if (req.method === 'GET') {
    if (!requireRole(auth, res, READ_ROLES)) return;
    const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
    if (queryTenant && queryTenant !== auth.tenantId) {
      return res.status(403).json({ error: 'El tenant solicitado no coincide con la sesión.' });
    }
    let periodRange: { from: string; to: string } | null;
    try {
      periodRange = readPeriodRange(req.query);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'El rango de fechas no es válido.' });
    }
    const periodEmployeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId.trim() : '';
    if (periodEmployeeId.length > 120) return res.status(400).json({ error: 'El colaborador del informe no es válido.' });

    const [employeesResult, accountsResult, transactionsResult] = await Promise.all([
      supabaseAdmin
        .from('pos_employees')
        .select('external_id, name, is_active')
        .eq('tenant_id', auth.tenantId)
        .order('name', { ascending: true })
        .limit(250),
      supabaseAdmin
        .from('pos_employee_credit_accounts')
        .select('employee_id, employee_name, status, balance, updated_at')
        .eq('tenant_id', auth.tenantId)
        .order('employee_name', { ascending: true })
        .limit(250),
      supabaseAdmin
        .from('pos_employee_credit_transactions')
        .select('id, account_id, employee_id, transaction_type, amount, balance_after, order_id, reference, notes, idempotency_key, created_by, created_at')
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false })
        .limit(500)
    ]);

    if (employeesResult.error || accountsResult.error || transactionsResult.error) {
      console.error('[Employee Credit] No se pudo cargar el registro del tenant.');
      return res.status(503).json({ error: 'No se pudo cargar el registro de consumo. Verifica que la migración de crédito esté aplicada.' });
    }

    const employees = (employeesResult.data || []).map((row: any) => ({
      id: String(row.external_id),
      name: String(row.name || 'Colaborador'),
      active: row.is_active !== false
    }));
    const employeeNames = new Map(employees.map(employee => [employee.id, employee.name]));
    const accounts = (accountsResult.data || []).map((row: any) => ({
      employeeId: String(row.employee_id),
      employeeName: employeeNames.get(String(row.employee_id)) || String(row.employee_name || 'Colaborador'),
      status: String(row.status || 'ACTIVE'),
      balance: Number(row.balance || 0),
      updatedAt: String(row.updated_at || '')
    }));
    const accountNames = new Map(accounts.map(account => [account.employeeId, account.employeeName]));
    const transactions = (transactionsResult.data || []).map((row: any) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      employeeId: String(row.employee_id),
      employeeName: employeeNames.get(String(row.employee_id)) || accountNames.get(String(row.employee_id)) || 'Colaborador',
      type: transactionType(row.transaction_type),
      amount: Number(row.amount || 0),
      balanceAfter: Number(row.balance_after || 0),
      orderId: typeof row.order_id === 'string' ? row.order_id : undefined,
      orderNumber: typeof row.reference === 'string' && row.transaction_type === 'CHARGE' ? row.reference : undefined,
      reference: typeof row.reference === 'string' ? row.reference : undefined,
      notes: typeof row.notes === 'string' ? row.notes : undefined,
      idempotencyKey: String(row.idempotency_key || ''),
      createdBy: typeof row.created_by === 'string' ? row.created_by : undefined,
      createdAt: String(row.created_at || '')
    }));

    let periodReport;
    if (periodRange) {
      const periodEmployeeNames = new Map(employeeNames);
      accounts.forEach(account => {
        if (!periodEmployeeNames.has(account.employeeId)) periodEmployeeNames.set(account.employeeId, account.employeeName);
      });
      const report = new EmployeeCreditPeriodReportAccumulator(periodRange.from, periodRange.to, periodEmployeeNames);
      let offset = 0;
      while (true) {
        let reportQuery = supabaseAdmin
          .from('pos_employee_credit_transactions')
          .select('id, account_id, employee_id, transaction_type, amount, balance_after, order_id, reference, notes, idempotency_key, created_by, created_at')
          .eq('tenant_id', auth.tenantId)
          .gte('created_at', periodRange.from)
          .lt('created_at', periodRange.to)
          .order('created_at', { ascending: false })
          .range(offset, offset + PERIOD_REPORT_PAGE_SIZE - 1);
        if (periodEmployeeId) reportQuery = reportQuery.eq('employee_id', periodEmployeeId);

        const reportPage = await reportQuery;
        if (reportPage.error) {
          console.error('[Employee Credit] No se pudo cargar el informe por periodo.');
          return res.status(503).json({ error: 'No se pudo cargar el informe de consumo del periodo.' });
        }
        const rows = reportPage.data || [];
        report.add(rows);
        const currentReport = report.toReport();
        if (currentReport.transactionCount > MAX_PERIOD_REPORT_TRANSACTIONS) {
          return res.status(413).json({ error: 'El periodo supera el máximo de movimientos para un informe. Selecciona un rango más corto.' });
        }
        if (rows.length < PERIOD_REPORT_PAGE_SIZE) break;
        offset += PERIOD_REPORT_PAGE_SIZE;
      }
      periodReport = report.toReport();
    }

    return res.status(200).json({ success: true, tenantId: auth.tenantId, accounts, employees, transactions, hasMoreTransactions: transactions.length === 500, periodReport });
  }

  if (!requireRole(auth, res, ROLE_PERMISSIONS.offlineSync.PAYMENT)) return;
  const body = (req.body || {}) as Record<string, unknown>;
  if (typeof body.tenantId === 'string' && body.tenantId !== auth.tenantId) {
    return res.status(403).json({ error: 'El tenant de la operación no coincide con la sesión.' });
  }
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
  if (!employeeId || employeeId.length > 120) return res.status(400).json({ error: 'El colaborador no es válido.' });
  const amount = safeAmount(body.amount);
  if (!amount) return res.status(400).json({ error: 'El monto del abono debe ser mayor que cero.' });
  const clientKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const containsControlCharacter = Array.from(clientKey).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!clientKey || clientKey.length > 160 || containsControlCharacter) {
    return res.status(400).json({ error: 'La operación de abono no tiene una clave válida.' });
  }

  try {
    const operation = await recordEmployeeCreditTransaction(supabaseAdmin, {
      tenantId: auth.tenantId,
      employeeId,
      type: 'PAYMENT',
      amount,
      idempotencyKey: `employee-credit-payment:${clientKey}`,
      reference: typeof body.reference === 'string' ? body.reference.slice(0, 200) : null,
      createdBy: auth.userId
    });
    return res.status(200).json({
      success: true,
      tenantId: auth.tenantId,
      transaction: {
        accountId: operation.accountId,
        id: operation.transactionId,
        employeeId: operation.employeeId,
        employeeName: operation.employeeName,
        type: operation.type,
        amount: operation.amount,
        balanceAfter: operation.balanceAfter,
        reference: operation.reference,
        idempotencyKey: operation.idempotencyKey,
        createdAt: operation.createdAt,
        alreadyApplied: operation.alreadyApplied
      }
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'No se pudo registrar el abono.';
    if (/saldo pendiente|abono supera/i.test(message)) return res.status(409).json({ error: message });
    if (/colaborador no existe|inactivo/i.test(message)) return res.status(404).json({ error: message });
    if (/inválid|válid/i.test(message)) return res.status(400).json({ error: message });
    console.error('[Employee Credit] No se pudo registrar el abono.');
    return res.status(503).json({ error: message });
  }
}
