import type { MenuItem } from '../types';
import { getStoredTenantId, getTenantItem, setTenantItem } from './tenantStorage.ts';

const MENU_STORAGE_KEY = 'menu';
const CATALOG_STORAGE_KEY = 'inventory_ingredients';
const INVENTORY_MOVEMENTS_KEY = 'inventory_movements';

export interface InventoryIngredient {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock?: number;
}

export interface InventoryMovement {
  id: string;
  timestamp: string;
  idempotencyKey?: string;
  type: 'SALE_DEDUCTION' | 'DISPATCH_DEDUCTION' | 'WASTE' | 'RESTOCK';
  productName: string;
  quantity: number;
  details: string;
}

export interface StockPrediction {
  itemId: string;
  itemName: string;
  remainingPortions: number;
  criticalIngredient?: string;
  isCritical: boolean;
  isDepleted: boolean;
}

export function normalizeIngredientName(name: string): string {
  return String(name || '').trim().normalize('NFKC').toLocaleLowerCase();
}

export function ingredientIdForName(name: string): string {
  return `ingredient:${encodeURIComponent(normalizeIngredientName(name)).slice(0, 180)}`;
}

function normalizeUnit(unit: string): string {
  const value = String(unit || '').trim().toLocaleLowerCase();
  if (['g', 'gr', 'gramo', 'gramos'].includes(value)) return 'g';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(value)) return 'kg';
  if (['ml', 'mililitro', 'mililitros'].includes(value)) return 'ml';
  if (['l', 'lt', 'litro', 'litros'].includes(value)) return 'L';
  if (['u', 'ud', 'unidad', 'unidades'].includes(value)) return 'unidad';
  return String(unit || '').trim() || 'unidad';
}

function unitFamily(unit: string): 'mass' | 'volume' | 'count' | 'other' {
  const normalized = normalizeUnit(unit);
  if (normalized === 'g' || normalized === 'kg') return 'mass';
  if (normalized === 'ml' || normalized === 'L') return 'volume';
  if (normalized === 'unidad') return 'count';
  return 'other';
}

function toBase(value: number, unit: string): number {
  const normalized = normalizeUnit(unit);
  if (normalized === 'kg' || normalized === 'L') return value * 1000;
  return value;
}

function fromBase(value: number, unit: string): number {
  const normalized = normalizeUnit(unit);
  if (normalized === 'kg' || normalized === 'L') return value / 1000;
  return value;
}

function safeQty(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function safeStock(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export class InventoryService {
  private readStoredMenu(tenantId?: string): MenuItem[] {
    try {
      const parsed = getTenantItem<MenuItem[]>(MENU_STORAGE_KEY, tenantId);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [];
  }

  private migrateLegacyCatalog(menu: MenuItem[]): InventoryIngredient[] {
    const byName = new Map<string, InventoryIngredient>();
    for (const product of menu) {
      for (const recipeItem of Array.isArray(product.ingredients) ? product.ingredients : []) {
        const name = String(recipeItem.name || '').trim();
        const key = normalizeIngredientName(name);
        if (!key) continue;
        const unit = normalizeUnit(recipeItem.unit);
        const family = unitFamily(unit);
        const current = byName.get(key);
        if (!current) {
          byName.set(key, {
            id: ingredientIdForName(name),
            name,
            unit: family === 'mass' ? 'g' : family === 'volume' ? 'ml' : unit,
            currentStock: safeStock(recipeItem.currentStock) * (unit === 'kg' || unit === 'L' ? 1000 : 1),
            minimumStock: 0
          });
          continue;
        }
        if (unitFamily(current.unit) !== family) continue;
        const stockInCatalogUnit = fromBase(toBase(safeStock(recipeItem.currentStock), unit), current.unit);
        // Legacy stock was copied into each product recipe. Use the lowest
        // recorded value to avoid overstating stock during one-time migration.
        current.currentStock = Math.min(current.currentStock, stockInCatalogUnit);
      }
    }
    return [...byName.values()];
  }

  private ensureCatalog(menu: MenuItem[], tenantId?: string): InventoryIngredient[] {
    const stored = getTenantItem<InventoryIngredient[]>(CATALOG_STORAGE_KEY, tenantId);
    if (Array.isArray(stored)) {
      return stored
        .filter(item => item && typeof item.name === 'string' && item.name.trim())
        .map(item => ({
          id: item.id || ingredientIdForName(item.name),
          name: item.name.trim(),
          unit: normalizeUnit(item.unit),
          currentStock: safeStock(item.currentStock),
          minimumStock: safeStock(item.minimumStock)
        }));
    }

    const migrated = this.migrateLegacyCatalog(menu);
    setTenantItem(CATALOG_STORAGE_KEY, migrated, tenantId);
    if (menu.length > 0) {
      const hydrated = this.withCatalogStock(menu, migrated);
      setTenantItem(MENU_STORAGE_KEY, hydrated, tenantId);
    }
    return migrated;
  }

  private withCatalogStock(menu: MenuItem[], catalog: InventoryIngredient[]): MenuItem[] {
    const byId = new Map(catalog.map(item => [item.id, item]));
    const byName = new Map(catalog.map(item => [normalizeIngredientName(item.name), item]));
    return menu.map(product => ({
      ...product,
      ingredients: (Array.isArray(product.ingredients) ? product.ingredients : []).map(recipeItem => {
        const master = (recipeItem.ingredientId && byId.get(recipeItem.ingredientId)) || byName.get(normalizeIngredientName(recipeItem.name));
        if (!master) return { ...recipeItem };
        const sourceUnit = normalizeUnit(recipeItem.unit);
        const canConvertUnit = unitFamily(sourceUnit) === unitFamily(master.unit);
        return {
          ...recipeItem,
          ingredientId: master.id,
          name: master.name,
          unit: master.unit,
          requiredQty: canConvertUnit ? fromBase(toBase(safeQty(recipeItem.requiredQty), sourceUnit), master.unit) : recipeItem.requiredQty,
          currentStock: master.currentStock
        };
      })
    }));
  }

  /** Incorpora recetas/stock recibidos por realtime al catálogo local sin emitir otro evento. */
  public reconcileMenuCatalog(menu: MenuItem[], tenantId?: string): MenuItem[] {
    const stored = getTenantItem<InventoryIngredient[]>(CATALOG_STORAGE_KEY, tenantId);
    const catalog = Array.isArray(stored) ? stored.map(item => ({ ...item })) : [];
    const byId = new Map(catalog.map(item => [item.id, item]));
    const byName = new Map(catalog.map(item => [normalizeIngredientName(item.name), item]));
    for (const product of menu) {
      for (const recipe of Array.isArray(product.ingredients) ? product.ingredients : []) {
        const name = String(recipe.name || '').trim();
        if (!name) continue;
        const id = recipe.ingredientId || ingredientIdForName(name);
        const existing = byId.get(id) || byName.get(normalizeIngredientName(name));
        const master: InventoryIngredient = {
          id,
          name,
          unit: normalizeUnit(recipe.unit),
          currentStock: safeStock(recipe.currentStock),
          minimumStock: existing?.minimumStock || 0
        };
        if (existing && existing.id !== id) {
          const index = catalog.findIndex(item => item.id === existing.id);
          if (index >= 0) catalog.splice(index, 1);
        }
        byId.set(id, master);
        byName.set(normalizeIngredientName(name), master);
        const oldIndex = catalog.findIndex(item => item.id === id);
        if (oldIndex >= 0) catalog[oldIndex] = master;
        else catalog.push(master);
      }
    }
    const reconciled = this.withCatalogStock(menu, catalog);
    setTenantItem(CATALOG_STORAGE_KEY, catalog, tenantId);
    setTenantItem(MENU_STORAGE_KEY, reconciled, tenantId);
    return reconciled;
  }

  public getMenu(tenantId?: string): MenuItem[] {
    const menu = this.readStoredMenu(tenantId);
    return this.withCatalogStock(menu, this.ensureCatalog(menu, tenantId));
  }

  public getCatalog(menu?: MenuItem[], tenantId?: string): InventoryIngredient[] {
    return this.ensureCatalog(menu || this.readStoredMenu(tenantId), tenantId);
  }

  public saveCatalogAndMenu(catalog: InventoryIngredient[], menu: MenuItem[], tenantId?: string): MenuItem[] {
    const cleanCatalog = catalog
      .filter(item => item && String(item.name || '').trim())
      .map(item => ({
        id: item.id || ingredientIdForName(item.name),
        name: String(item.name).trim(),
        unit: normalizeUnit(item.unit),
        currentStock: safeStock(item.currentStock),
        minimumStock: safeStock(item.minimumStock)
      }));
    const savedMenu = this.withCatalogStock(menu, cleanCatalog);
    setTenantItem(CATALOG_STORAGE_KEY, cleanCatalog, tenantId);
    setTenantItem(MENU_STORAGE_KEY, savedMenu, tenantId);
    this.dispatchUpdates(savedMenu, cleanCatalog, tenantId);
    return savedMenu;
  }

  /** Guarda menú por compatibilidad con los flujos existentes. */
  public saveMenu(menu: MenuItem[], tenantId?: string): void {
    const catalog = this.getCatalog(menu, tenantId);
    this.saveCatalogAndMenu(catalog, menu, tenantId);
  }

  private dispatchUpdates(menu: MenuItem[], catalog: InventoryIngredient[], tenantId?: string): void {
    if (typeof window === 'undefined') return;
    const scopedTenantId = tenantId || getStoredTenantId();
    window.dispatchEvent(new CustomEvent('saborai_menu_updated', { detail: { tenantId: scopedTenantId, menu } }));
    window.dispatchEvent(new CustomEvent('saborai_inventory_updated', { detail: { tenantId: scopedTenantId, menu } }));
    window.dispatchEvent(new CustomEvent('saborai_inventory_catalog_updated', { detail: { tenantId: scopedTenantId, catalog } }));
  }

  public getStockPredictions(menu?: MenuItem[]): StockPrediction[] {
    const activeMenu = menu || this.getMenu();
    return activeMenu.map(item => {
      if (!item.ingredients || item.ingredients.length === 0) {
        return {
          itemId: item.id,
          itemName: item.name,
          remainingPortions: 999,
          isCritical: false,
          isDepleted: item.available === false
        };
      }

      let minPortions = Infinity;
      let bottleneckIngredient = '';
      for (const ingredient of item.ingredients) {
        const required = safeQty(ingredient.requiredQty) || 1;
        const current = safeStock(ingredient.currentStock);
        const portions = Math.max(0, Math.floor(current / required));
        if (portions < minPortions) {
          minPortions = portions;
          bottleneckIngredient = ingredient.name;
        }
      }

      const remainingPortions = minPortions === Infinity ? 999 : minPortions;
      const isDepleted = remainingPortions <= 0 || item.available === false;
      return {
        itemId: item.id,
        itemName: item.name,
        remainingPortions,
        criticalIngredient: bottleneckIngredient,
        isCritical: !isDepleted && remainingPortions <= 3,
        isDepleted
      };
    });
  }

  public deductItemsStock(
    items: Array<{ name: string; quantity: number; menuItemId?: string }>,
    movementType: InventoryMovement['type'] | string = 'SALE_DEDUCTION',
    reason?: string,
    idempotencyKey?: string,
    tenantId?: string
  ): { updatedMenu: MenuItem[]; depletedItems: string[] } {
    const menu = this.getMenu(tenantId);
    if (menu.length === 0 || items.length === 0) return { updatedMenu: menu, depletedItems: [] };
    if (idempotencyKey && this.getMovements(tenantId).some(movement => movement.idempotencyKey === idempotencyKey)) {
      return { updatedMenu: menu, depletedItems: [] };
    }

    const normalizedType: InventoryMovement['type'] =
      movementType === 'DISPATCH_DEDUCTION' || movementType === 'WASTE' || movementType === 'RESTOCK'
        ? movementType
        : 'SALE_DEDUCTION';
    const catalog = this.getCatalog(menu, tenantId).map(item => ({ ...item }));
    const catalogById = new Map(catalog.map(item => [item.id, item]));
    const byName = new Map<string, InventoryIngredient>();
    catalog.forEach(item => byName.set(normalizeIngredientName(item.name), item));
    const byMenuId = new Map<string, number>();
    const byProductName = new Map<string, number>();
    for (const item of items) {
      const quantity = safeQty(item.quantity);
      if (!quantity) continue;
      const name = normalizeIngredientName(item.name);
      if (item.menuItemId) byMenuId.set(item.menuItemId, (byMenuId.get(item.menuItemId) || 0) + quantity);
      else if (name) byProductName.set(name, (byProductName.get(name) || 0) + quantity);
    }

    const depletedItems: string[] = [];
    const movements: InventoryMovement[] = [];
    const now = new Date().toISOString();
    const updatedMenu = menu.map(product => {
      const quantity = byMenuId.get(product.id) ?? byProductName.get(normalizeIngredientName(product.name)) ?? 0;
      if (!quantity || !Array.isArray(product.ingredients) || product.ingredients.length === 0) return product;

      let depleted = false;
      for (const recipeItem of product.ingredients) {
        const master = (recipeItem.ingredientId && catalogById.get(recipeItem.ingredientId)) || byName.get(normalizeIngredientName(recipeItem.name));
        if (!master) continue;
        const requiredQty = safeQty(recipeItem.requiredQty) || 1;
        const deduction = requiredQty * quantity;
        master.currentStock = Math.max(0, safeStock(master.currentStock) - deduction);
        if (master.currentStock <= 0) depleted = true;
        movements.push({
          id: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: now,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          type: normalizedType,
          productName: product.name,
          quantity,
          details: `${reason ? `${reason}: ` : ''}Descuento de ${deduction} ${master.unit} de "${master.name}" (stock restante: ${master.currentStock})`
        });
      }
      if (depleted) depletedItems.push(product.name);
      return { ...product, available: depleted ? false : (product.available ?? true) };
    });

    this.saveCatalogAndMenu(catalog, updatedMenu, tenantId);
    this.recordMovements(movements, tenantId);
    return { updatedMenu: this.getMenu(tenantId), depletedItems };
  }

  public replenishIngredient(ingredientId: string, addQty: number, reason = 'Reabastecimiento', tenantId?: string): InventoryIngredient[] {
    const menu = this.getMenu(tenantId);
    const catalog = this.getCatalog(menu, tenantId).map(item => ({ ...item }));
    const target = catalog.find(item => item.id === ingredientId);
    const quantity = safeQty(addQty);
    if (!target || !quantity) return catalog;
    target.currentStock = safeStock(target.currentStock) + quantity;
    const updatedMenu = this.withCatalogStock(menu, catalog).map(product => {
      const hasRecipe = product.ingredients.length > 0;
      const allHaveStock = product.ingredients.every(item => safeStock(item.currentStock) > 0);
      return hasRecipe && allHaveStock ? { ...product, available: true } : product;
    });
    this.saveCatalogAndMenu(catalog, updatedMenu, tenantId);
    this.recordMovements([{
      id: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type: 'RESTOCK',
      productName: target.name,
      quantity,
      details: `${reason}: +${quantity} ${target.unit} de "${target.name}"`
    }], tenantId);
    return catalog;
  }

  /** Compatibilidad para callers antiguos que reabastecen por nombre. */
  public replenishStock(_productName: string, ingredientName: string, addQty: number): MenuItem[] {
    const target = this.getCatalog().find(item => normalizeIngredientName(item.name) === normalizeIngredientName(ingredientName));
    if (target) this.replenishIngredient(target.id, addQty);
    return this.getMenu();
  }

  public recordWaste(productName: string, qty: number, reason: string, tenantId?: string): boolean {
    const target = this.getMenu(tenantId).find(product => normalizeIngredientName(product.name) === normalizeIngredientName(productName));
    if (!target) return false;
    this.deductItemsStock([{ menuItemId: target.id, name: target.name, quantity: qty }], 'WASTE', reason || 'Merma', undefined, tenantId);
    return true;
  }

  public getMovements(tenantId?: string): InventoryMovement[] {
    try {
      const saved = getTenantItem<InventoryMovement[]>(INVENTORY_MOVEMENTS_KEY, tenantId);
      if (Array.isArray(saved)) return saved;
    } catch {}
    return [];
  }

  private recordMovements(newMovements: InventoryMovement[], tenantId?: string): void {
    if (newMovements.length === 0) return;
    try {
      const updated = [...newMovements, ...this.getMovements(tenantId)].slice(0, 200);
      setTenantItem(INVENTORY_MOVEMENTS_KEY, updated, tenantId);
    } catch {}
  }
}

export const inventoryService = new InventoryService();
