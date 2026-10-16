import { MenuItem } from '../types';

const MENU_STORAGE_KEY = 'saborai_menu';
const INVENTORY_MOVEMENTS_KEY = 'saborai_inventory_movements';

export interface InventoryMovement {
  id: string;
  timestamp: string;
  type: 'SALE_DEDUCTION' | 'DISPATCH_DEDUCTION' | 'WASTE' | 'RESTOCK';
  productName: string;
  quantity: number;
  details: string;
}

export class InventoryService {
  /**
   * Obtiene la lista actual de productos del menú y sus fichas técnicas de inventario
   */
  public getMenu(): MenuItem[] {
    try {
      const saved = localStorage.getItem(MENU_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }

  /**
   * Guarda el menú con las cantidades de stock actualizadas y notifica a la aplicación
   */
  public saveMenu(menu: MenuItem[]): void {
    try {
      localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(menu));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saborai_menu_updated', { detail: menu }));
        window.dispatchEvent(new CustomEvent('saborai_inventory_updated', { detail: menu }));
      }
    } catch (e) {
      console.error('Error al guardar inventario:', e);
    }
  }

  /**
   * Descuenta automáticamente los insumos e ingredientes formulados en la ficha técnica
   * currentStock = currentStock - (requiredQty * cantidadPlatos)
   */
  public deductItemsStock(
    items: Array<{ name: string; quantity: number }>,
    movementType: InventoryMovement['type'] | string = 'SALE_DEDUCTION'
  ): { updatedMenu: MenuItem[]; depletedItems: string[] } {
    const menu = this.getMenu();
    if (menu.length === 0 || items.length === 0) {
      return { updatedMenu: menu, depletedItems: [] };
    }

    const normalizedType: InventoryMovement['type'] =
      movementType === 'DISPATCH_DEDUCTION' || movementType === 'WASTE' || movementType === 'RESTOCK'
        ? movementType
        : 'SALE_DEDUCTION';

    const depletedItems: string[] = [];
    const movements: InventoryMovement[] = [];
    const now = new Date().toISOString();

    // Mapeo rápido de platillos a descontar por nombre normalizado
    const itemsMap = new Map<string, number>();
    for (const item of items) {
      const key = item.name.trim().toLowerCase();
      itemsMap.set(key, (itemsMap.get(key) || 0) + item.quantity);
    }

    const updatedMenu = menu.map(prod => {
      const matchQty = itemsMap.get(prod.name.trim().toLowerCase());
      if (!matchQty || matchQty <= 0) return prod;

      // Si el platillo no tiene receta ni ingredientes configurados, continúa
      if (!Array.isArray(prod.ingredients) || prod.ingredients.length === 0) {
        return prod;
      }

      let hasDepletedIngredient = false;
      const updatedIngredients = prod.ingredients.map(ing => {
        const requiredQty = Number(ing.requiredQty) || 1;
        const totalDeduction = requiredQty * matchQty;
        const currentStock = Number(ing.currentStock) || 0;
        const newStock = Math.max(0, currentStock - totalDeduction);

        if (newStock <= 0) {
          hasDepletedIngredient = true;
        }

        movements.push({
          id: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          type: normalizedType,
          productName: prod.name,
          quantity: matchQty,
          details: `Descuento de ${totalDeduction} ${ing.unit} de "${ing.name}" (Stock restante: ${newStock})`
        });

        return {
          ...ing,
          currentStock: newStock
        };
      });

      // Si algún insumo llega a 0, marcar el platillo visualmente como NO disponible (Agotado)
      const isAvailable = !hasDepletedIngredient && (prod.available ?? true);
      if (hasDepletedIngredient) {
        depletedItems.push(prod.name);
      }

      return {
        ...prod,
        available: isAvailable,
        ingredients: updatedIngredients
      };
    });

    this.saveMenu(updatedMenu);
    this.recordMovements(movements);

    return { updatedMenu, depletedItems };
  }

  /**
   * Reabastecer stock de un insumo específico
   */
  public replenishStock(productName: string, ingredientName: string, addQty: number): MenuItem[] {
    const menu = this.getMenu();
    const updated = menu.map(prod => {
      if (prod.name.trim().toLowerCase() !== productName.trim().toLowerCase()) return prod;

      let allIngredientsHaveStock = true;
      const updatedIngredients = (prod.ingredients || []).map(ing => {
        if (ing.name.trim().toLowerCase() === ingredientName.trim().toLowerCase()) {
          const newStock = Math.max(0, (ing.currentStock || 0) + addQty);
          if (newStock <= 0) allIngredientsHaveStock = false;
          return { ...ing, currentStock: newStock };
        }
        if ((ing.currentStock || 0) <= 0) allIngredientsHaveStock = false;
        return ing;
      });

      return {
        ...prod,
        available: allIngredientsHaveStock,
        ingredients: updatedIngredients
      };
    });

    this.saveMenu(updated);
    this.recordMovements([{
      id: `mov_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'RESTOCK',
      productName,
      quantity: addQty,
      details: `Reabastecimiento de +${addQty} a insumo "${ingredientName}"`
    }]);

    return updated;
  }

  /**
   * Registra merma directa de un platillo o insumo
   */
  public recordWaste(productName: string, qty: number, reason: string): boolean {
    const menu = this.getMenu();
    const target = menu.find(p => p.name.trim().toLowerCase() === productName.trim().toLowerCase());
    if (!target) return false;

    this.deductItemsStock([{ name: productName, quantity: qty }], 'WASTE');
    return true;
  }

  /**
   * Historial de movimientos de inventario
   */
  public getMovements(): InventoryMovement[] {
    try {
      const saved = localStorage.getItem(INVENTORY_MOVEMENTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  }

  private recordMovements(newMovements: InventoryMovement[]): void {
    if (newMovements.length === 0) return;
    try {
      const existing = this.getMovements();
      const updated = [...newMovements, ...existing].slice(0, 200); // Guardar últimos 200
      localStorage.setItem(INVENTORY_MOVEMENTS_KEY, JSON.stringify(updated));
    } catch {}
  }
}

export const inventoryService = new InventoryService();
