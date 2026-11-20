import type { CashShiftV2Repository } from './cashShiftV2Service.js';

function mapFiscalProfile(row: any) {
  if (!row) return null;
  return {
    authority: 'SERVER' as const,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    taxRegime: row.tax_regime,
    currency: row.currency,
    priceBasis: row.price_basis
  };
}

function raiseDatabaseError(error: unknown, label: string): never {
  const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'database error';
  throw new Error(`${label}: ${detail}`);
}

export function createCashShiftV2Repository(supabase: any): CashShiftV2Repository {
  return {
    async getBranch(tenantId, branchId) {
      const { data, error } = await supabase.from('pos_branches')
        .select('id,tenant_id,is_active')
        .eq('id', branchId).eq('tenant_id', tenantId).maybeSingle();
      if (error) raiseDatabaseError(error, 'branch lookup');
      return data ? { id: data.id, tenantId: data.tenant_id, active: data.is_active === true } : null;
    },
    async getRegister(tenantId, branchId, cashRegisterId) {
      const { data, error } = await supabase.from('pos_cash_registers')
        .select('id,tenant_id,branch_id,is_active')
        .eq('id', cashRegisterId).eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
      if (error) raiseDatabaseError(error, 'register lookup');
      return data ? {
        id: data.id, tenantId: data.tenant_id, branchId: data.branch_id, active: data.is_active === true
      } : null;
    },
    async getFiscalProfile(tenantId, branchId) {
      const { data, error } = await supabase.from('pos_cash_v2_branch_fiscal_profiles')
        .select('tenant_id,branch_id,tax_regime,currency,price_basis')
        .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
      if (error) raiseDatabaseError(error, 'fiscal profile lookup');
      return mapFiscalProfile(data);
    },
    async hasActiveMembership(tenantId, branchId, employeeId) {
      const { data, error } = await supabase.from('pos_employee_branch_memberships')
        .select('employee_id')
        .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('employee_id', employeeId)
        .eq('status', 'ACTIVE').maybeSingle();
      if (error) raiseDatabaseError(error, 'branch membership lookup');
      return !!data;
    },
    async getDailyOpening(tenantId, branchId, cashRegisterId) {
      const { data: opening, error: openingError } = await supabase.from('pos_daily_cash_openings')
        .select('business_date')
        .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('cash_register_id', cashRegisterId)
        .order('opened_at', { ascending: false }).limit(1).maybeSingle();
      if (openingError) raiseDatabaseError(openingError, 'daily opening lookup');
      if (!opening) return null;
      const businessDate = String(opening.business_date);
      const { data: closure, error: closureError } = await supabase.from('pos_daily_cash_closures')
        .select('id')
        .eq('tenant_id', tenantId).eq('branch_id', branchId)
        .eq('cash_register_id', cashRegisterId).eq('business_date', businessDate).maybeSingle();
      if (closureError) raiseDatabaseError(closureError, 'daily closure lookup');
      return { businessDate, closed: !!closure };
    },
    async getBranchMode(tenantId, branchId) {
      const { data, error } = await supabase.from('pos_cash_v2_branch_controls')
        .select('state').eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
      if (error) raiseDatabaseError(error, 'branch mode lookup');
      return data ? { state: data.state } : null;
    },
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    }
  };
}
