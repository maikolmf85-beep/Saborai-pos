import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ChevronRight, Layers, Plus, Save, Trash2 } from 'lucide-react';
import { MenuItem } from '../types';
import { InventoryIngredient, inventoryService, ingredientIdForName, normalizeIngredientName } from '../services/inventoryService';
import { posCloudService } from '../services/posCloudService';
import { localDB } from '../services/db';

interface InventoryRecipesProps {
  tenantId: string;
}

type RecipeDraft = { ingredientId: string; requiredQty: number };

function readInitialMenu(tenantId: string): MenuItem[] {
  try {
    const saved = inventoryService.getMenu(tenantId);
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch {}
  return [];
}

function localOperationId(prefix: string, tenantId: string, detail: string): string {
  return `${prefix}:${tenantId}:${detail}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`.slice(0, 160);
}

export const InventoryRecipes: React.FC<InventoryRecipesProps> = ({ tenantId }) => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => readInitialMenu(tenantId));
  const [catalog, setCatalog] = useState<InventoryIngredient[]>(() => inventoryService.getCatalog(readInitialMenu(tenantId), tenantId));
  const [selectedProductId, setSelectedProductId] = useState<string>(() => readInitialMenu(tenantId)[0]?.id || '');
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft[]>([]);
  const [recipeIngredientId, setRecipeIngredientId] = useState('');
  const [recipeQuantity, setRecipeQuantity] = useState('');
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientUnit, setIngredientUnit] = useState('g');
  const [initialStock, setInitialStock] = useState('');
  const [restockQty, setRestockQty] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRestocking, setIsRestocking] = useState(false);

  const selectedProduct = menuItems.find(item => item.id === selectedProductId) || null;
  const selectedIngredients = selectedProduct?.ingredients;
  const ingredientsById = useMemo(() => new Map(catalog.map(item => [item.id, item])), [catalog]);

  useEffect(() => {
    const reload = (event: Event) => {
      const eventTenantId = (event as CustomEvent<{ tenantId?: string }>).detail?.tenantId;
      if (eventTenantId && eventTenantId !== tenantId) return;
      const savedMenu = inventoryService.getMenu(tenantId);
      if (savedMenu.length) {
        setMenuItems(savedMenu);
        setSelectedProductId(current => savedMenu.some(item => item.id === current) ? current : savedMenu[0]?.id || '');
      }
      setCatalog(inventoryService.getCatalog(savedMenu, tenantId));
    };
    window.addEventListener('saborai_menu_updated', reload);
    window.addEventListener('saborai_inventory_updated', reload);
    window.addEventListener('saborai_inventory_catalog_updated', reload);
    return () => {
      window.removeEventListener('saborai_menu_updated', reload);
      window.removeEventListener('saborai_inventory_updated', reload);
      window.removeEventListener('saborai_inventory_catalog_updated', reload);
    };
  }, [tenantId]);

  useEffect(() => {
    setRecipeDraft((selectedIngredients || []).map(item => ({
      ingredientId: item.ingredientId || ingredientIdForName(item.name),
      requiredQty: Number(item.requiredQty) || 1
    })));
  }, [selectedProductId, selectedIngredients]);

  useEffect(() => {
    if (!tenantId || !localDB.isOnline() || menuItems.length === 0) return;
    let cancelled = false;
    void posCloudService.syncOperation<any>('LOAD_INVENTORY_CONFIG', {
      menuItemIds: menuItems.map(item => item.id)
    }, tenantId).then(result => {
      if (cancelled || !result) return;
      const remoteCatalog = Array.isArray(result.catalog) ? result.catalog as InventoryIngredient[] : [];
      const recipesByProduct = result.recipesByMenuItemId && typeof result.recipesByMenuItemId === 'object'
        ? result.recipesByMenuItemId as Record<string, Array<{ ingredientId: string; name: string; unit: string; requiredQty: number; currentStock: number }>>
        : {};
      if (remoteCatalog.length === 0 && Object.keys(recipesByProduct).length === 0) return;
      const localByName = new Map(catalog.map(item => [normalizeIngredientName(item.name), item]));
      const mergedCatalog = [...remoteCatalog];
      for (const local of catalog) {
        if (!mergedCatalog.some(item => normalizeIngredientName(item.name) === normalizeIngredientName(local.name))) mergedCatalog.push(local);
      }
      const mergedMenu = menuItems.map(product => Object.prototype.hasOwnProperty.call(recipesByProduct, product.id)
        ? { ...product, ingredients: recipesByProduct[product.id].map(recipe => ({ ...recipe, ingredientId: recipe.ingredientId || localByName.get(normalizeIngredientName(recipe.name))?.id || ingredientIdForName(recipe.name) })) }
        : product);
      const savedMenu = inventoryService.saveCatalogAndMenu(mergedCatalog, mergedMenu, tenantId);
      setCatalog(inventoryService.getCatalog(savedMenu, tenantId));
      setMenuItems(savedMenu);
      setNotice('Inventario sincronizado desde la nube.');
    }).catch(() => {
      if (!cancelled) setNotice('No se pudo cargar el inventario remoto; se conserva la copia local.');
    });
    return () => { cancelled = true; };
  // Load once for each tenant; subsequent edits are sent explicitly below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const persistCloudConfig = async (nextCatalog: InventoryIngredient[], nextMenu: MenuItem[]) => {
    const operationId = localOperationId('inventory-config', tenantId, 'snapshot');
    const payload = {
      ingredients: nextCatalog,
      menuItems: nextMenu.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        station: item.station,
        cabysCode: item.cabysCode,
        taxRate: item.taxRate,
        available: item.available,
        prepTime: item.prepTime,
        modifiers: item.modifiers || [],
        ingredients: (item.ingredients || []).map(recipe => ({
          ingredientId: recipe.ingredientId || ingredientIdForName(recipe.name),
          name: recipe.name,
          requiredQty: Number(recipe.requiredQty),
          unit: recipe.unit
        }))
      }))
    };
    try {
      const result = await posCloudService.syncOperation<any>('SAVE_INVENTORY_CONFIG', payload, tenantId, operationId);
      if (Array.isArray(result?.catalog)) {
        const remoteCatalog = result.catalog as InventoryIngredient[];
        const refreshedMenu = inventoryService.saveCatalogAndMenu(remoteCatalog, nextMenu, tenantId);
        setCatalog(inventoryService.getCatalog(refreshedMenu, tenantId));
        setMenuItems(refreshedMenu);
      }
      setNotice('Cambios guardados localmente y sincronizados con la nube.');
    } catch (error: any) {
      await localDB.enqueueOfflineAction('SAVE_INVENTORY_CONFIG', payload, 'Configuración de inventario pendiente de sincronización', tenantId, operationId);
      setNotice(`Guardado local; sincronización pendiente. ${error?.message || ''}`.trim());
    }
  };

  const saveLocalAndCloud = async (nextCatalog: InventoryIngredient[], nextMenu: MenuItem[]) => {
    const savedMenu = inventoryService.saveCatalogAndMenu(nextCatalog, nextMenu, tenantId);
    setCatalog(inventoryService.getCatalog(savedMenu, tenantId));
    setMenuItems(savedMenu);
    await persistCloudConfig(nextCatalog, savedMenu);
  };

  const handleAddIngredient = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = ingredientName.trim();
    const stock = Number(initialStock);
    if (!name || !Number.isFinite(stock) || stock < 0) return;
    if (catalog.some(item => normalizeIngredientName(item.name) === normalizeIngredientName(name))) {
      setNotice('Ese insumo ya existe en el catálogo compartido. Selecciónalo desde la receta.');
      return;
    }
    const newIngredient: InventoryIngredient = {
      id: ingredientIdForName(name),
      name,
      unit: ingredientUnit,
      currentStock: stock,
      minimumStock: 0
    };
    const nextCatalog = [...catalog, newIngredient];
    setIsSaving(true);
    await saveLocalAndCloud(nextCatalog, menuItems);
    setIsSaving(false);
    setIngredientName('');
    setInitialStock('');
    setRecipeIngredientId(newIngredient.id);
  };

  const handleAddRecipeIngredient = () => {
    const ingredientId = recipeIngredientId || catalog[0]?.id || '';
    const quantity = Number(recipeQuantity);
    if (!selectedProduct || !ingredientId || !Number.isFinite(quantity) || quantity <= 0) return;
    setRecipeDraft(current => {
      const existing = current.find(item => item.ingredientId === ingredientId);
      if (existing) return current.map(item => item.ingredientId === ingredientId ? { ...item, requiredQty: quantity } : item);
      return [...current, { ingredientId, requiredQty: quantity }];
    });
    setRecipeQuantity('');
  };

  const handleSaveRecipe = async () => {
    if (!selectedProduct) return;
    const recipe = recipeDraft.flatMap(row => {
      const ingredient = ingredientsById.get(row.ingredientId);
      const quantity = Number(row.requiredQty);
      if (!ingredient || !Number.isFinite(quantity) || quantity <= 0) return [];
      return [{ ingredientId: ingredient.id, name: ingredient.name, requiredQty: quantity, unit: ingredient.unit, currentStock: ingredient.currentStock }];
    });
    const nextMenu = menuItems.map(item => item.id === selectedProduct.id ? { ...item, ingredients: recipe } : item);
    setIsSaving(true);
    await saveLocalAndCloud(catalog, nextMenu);
    setIsSaving(false);
  };

  const handleRestock = async (ingredient: InventoryIngredient) => {
    const amount = Number(restockQty[ingredient.id]);
    if (isRestocking || !Number.isFinite(amount) || amount <= 0) return;
    if (amount > 100000000) {
      setNotice('La cantidad de reposición supera el máximo permitido.');
      return;
    }
    setIsRestocking(true);
    try {
      const operationId = localOperationId('inventory-adjust', tenantId, ingredient.id);
      const updatedCatalog = inventoryService.replenishIngredient(ingredient.id, amount, 'Reabastecimiento manual', tenantId);
      const updatedMenu = inventoryService.getMenu(tenantId);
      setCatalog(updatedCatalog);
      setMenuItems(updatedMenu);
      const payload = { ingredientId: ingredient.id, name: ingredient.name, adjustment: amount, reason: 'Reabastecimiento manual' };
      try {
        const result = await posCloudService.syncOperation<any>('ADJUST_INVENTORY', payload, tenantId, operationId);
        const confirmedStock = Number(result?.stockAfterOperation);
        if (Number.isFinite(confirmedStock) && confirmedStock >= 0) {
          const confirmedCatalog = updatedCatalog.map(item => item.id === ingredient.id ? { ...item, currentStock: confirmedStock } : item);
          const confirmedMenu = inventoryService.saveCatalogAndMenu(confirmedCatalog, updatedMenu, tenantId);
          setCatalog(confirmedCatalog);
          setMenuItems(confirmedMenu);
        }
        setNotice(`Stock de ${ingredient.name} actualizado en la nube.`);
      } catch (error: any) {
        await localDB.enqueueOfflineAction('ADJUST_INVENTORY', payload, `Reabastecimiento de ${ingredient.name} pendiente`, tenantId, operationId);
        setNotice(`Stock actualizado localmente; sincronización pendiente. ${error?.message || ''}`.trim());
      }
      setRestockQty(current => ({ ...current, [ingredient.id]: '' }));
    } finally {
      setIsRestocking(false);
    }
  };

  const saveDraftIngredient = (ingredientId: string, requiredQty: number) => {
    setRecipeDraft(current => current.map(item => item.ingredientId === ingredientId ? { ...item, requiredQty } : item));
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[#6b686d]/15 pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-black text-[#3b3733]">Inventario y recetas</h2>
          <p className="mt-1 text-sm text-[#6b686d]">Un catálogo de insumos compartido por platos y bebidas; el descuento ocurre al enviar a cocina o bar.</p>
        </div>
        {notice && <div role="status" className="max-w-xl rounded-xl border border-[#a9b994]/50 bg-[#a9b994]/15 px-3 py-2 text-xs text-[#3b3733]">{notice}</div>}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-4">
          <div className="rounded-2xl border border-[#6b686d]/15 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#3b3733]"><Layers className="h-4 w-4 text-[#588157]" />Platos y bebidas</h3>
            {menuItems.length === 0 ? <p className="text-sm text-[#6b686d]">Agrega productos al menú antes de definir recetas.</p> : (
              <div className="max-h-[360px] space-y-2 overflow-y-auto">
                {menuItems.map(item => {
                  const selected = item.id === selectedProductId;
                  const low = (item.ingredients || []).some(recipe => (ingredientsById.get(recipe.ingredientId || '')?.currentStock ?? recipe.currentStock) <= 0);
                  return (
                    <button key={item.id} type="button" onClick={() => setSelectedProductId(item.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${selected ? 'border-[#588157] bg-[#a9b994]/15' : 'border-[#6b686d]/15 hover:border-[#a9b994]'}`}>
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#3b3733]">{item.name}</span><span className="text-xs text-[#6b686d]">{item.station} · {(item.ingredients || []).length} insumos</span></span>
                      {low ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#588157]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#6b686d]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={handleAddIngredient} className="space-y-3 rounded-2xl border border-[#6b686d]/15 bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[#3b3733]"><Plus className="h-4 w-4 text-[#588157]" />Agregar insumo al catálogo</h3>
            <input value={ingredientName} onChange={event => setIngredientName(event.target.value)} maxLength={120} placeholder="Ej. Pollo deshuesado" className="w-full rounded-xl border border-[#6b686d]/25 px-3 py-2 text-sm" required />
            <div className="grid grid-cols-2 gap-2">
              <select value={ingredientUnit} onChange={event => setIngredientUnit(event.target.value)} className="rounded-xl border border-[#6b686d]/25 bg-white px-3 py-2 text-sm">
                <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="L">L</option><option value="unidad">unidad</option>
              </select>
              <input type="number" min="0" step="0.001" value={initialStock} onChange={event => setInitialStock(event.target.value)} placeholder="Existencia inicial" className="rounded-xl border border-[#6b686d]/25 px-3 py-2 text-sm" required />
            </div>
            <button disabled={isSaving} className="w-full rounded-xl bg-[#588157] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#476d46] disabled:opacity-50">{isSaving ? 'Guardando…' : 'Crear insumo compartido'}</button>
          </form>
        </section>

        <section className="space-y-4 xl:col-span-8">
          <div className="rounded-2xl border border-[#6b686d]/15 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#6b686d]/10 pb-3">
              <div><h3 className="text-base font-bold text-[#3b3733]">Receta editable</h3><p className="text-xs text-[#6b686d]">{selectedProduct ? `${selectedProduct.name} · estación ${selectedProduct.station}` : 'Selecciona un producto del menú'}</p></div>
              {selectedProduct && <button type="button" onClick={() => void handleSaveRecipe()} disabled={isSaving || isRestocking} className="inline-flex items-center gap-2 rounded-xl bg-[#588157] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Guardar receta</button>}
            </div>
            {selectedProduct ? <>
              <div className="space-y-2">
                {recipeDraft.map(row => {
                  const ingredient = ingredientsById.get(row.ingredientId);
                  if (!ingredient) return null;
                  return <div key={row.ingredientId} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 rounded-xl bg-[#f7f8f6] p-3">
                    <div className="min-w-0"><span className="block truncate text-sm font-semibold text-[#3b3733]">{ingredient.name}</span><span className="text-xs text-[#6b686d]">Existencia compartida: {ingredient.currentStock.toLocaleString()} {ingredient.unit}</span></div>
                    <label className="flex items-center gap-1"><input type="number" min="0.001" step="0.001" value={row.requiredQty} onChange={event => saveDraftIngredient(row.ingredientId, Number(event.target.value))} className="w-full rounded-lg border border-[#6b686d]/25 px-2 py-1.5 text-right text-sm" /><span className="text-xs text-[#6b686d]">{ingredient.unit}</span></label>
                    <button type="button" aria-label={`Quitar ${ingredient.name} de la receta`} onClick={() => setRecipeDraft(current => current.filter(item => item.ingredientId !== row.ingredientId))} className="rounded-lg p-2 text-[#6b686d] hover:bg-[#e8ece5]"><Trash2 className="h-4 w-4" /></button>
                  </div>;
                })}
                {recipeDraft.length === 0 && <p className="rounded-xl border border-dashed border-[#6b686d]/25 p-4 text-center text-sm text-[#6b686d]">Aún no hay ingredientes en esta receta.</p>}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px_auto]">
                <select value={recipeIngredientId} onChange={event => setRecipeIngredientId(event.target.value)} className="rounded-xl border border-[#6b686d]/25 bg-white px-3 py-2 text-sm" disabled={catalog.length === 0}>
                  <option value="">Seleccionar insumo…</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
                </select>
                <input type="number" min="0.001" step="0.001" value={recipeQuantity} onChange={event => setRecipeQuantity(event.target.value)} placeholder="Cantidad por porción" className="rounded-xl border border-[#6b686d]/25 px-3 py-2 text-sm" />
                <button type="button" onClick={handleAddRecipeIngredient} disabled={!catalog.length} className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#588157]/40 px-3 py-2 text-sm font-semibold text-[#476d46] disabled:opacity-40"><Plus className="h-4 w-4" />Añadir</button>
              </div>
            </> : <p className="py-8 text-center text-sm text-[#6b686d]">No hay productos para editar.</p>}
          </div>

          <div className="rounded-2xl border border-[#6b686d]/15 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#3b3733]"><Boxes className="h-4 w-4 text-[#588157]" />Catálogo único y existencias</h3>
            {catalog.length === 0 ? <p className="text-sm text-[#6b686d]">Crea el primer insumo para comenzar.</p> : <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {catalog.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#6b686d]/10 p-3">
                <div className="min-w-0"><span className="block truncate text-sm font-semibold text-[#3b3733]">{item.name}</span><span className="text-xs text-[#6b686d]">{item.currentStock.toLocaleString()} {item.unit} disponibles</span></div>
                <div className="flex shrink-0 items-center gap-1"><input type="number" min="0.001" max="100000000" step="0.001" aria-label={`Cantidad para reponer ${item.name}`} value={restockQty[item.id] || ''} onChange={event => setRestockQty(current => ({ ...current, [item.id]: event.target.value }))} placeholder="+ stock" className="w-20 rounded-lg border border-[#6b686d]/25 px-2 py-1.5 text-right text-xs" /><button type="button" onClick={() => void handleRestock(item)} disabled={isSaving || isRestocking} className="rounded-lg bg-[#a9b994]/25 px-2.5 py-1.5 text-xs font-bold text-[#3b3733] hover:bg-[#a9b994]/45 disabled:opacity-50">{isRestocking ? 'Guardando…' : 'Reponer'}</button></div>
              </div>)}
            </div>}
          </div>

          <div className="rounded-2xl border border-[#6b686d]/15 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold text-[#3b3733]">Movimientos recientes</h3>
            {inventoryService.getMovements(tenantId).slice(0, 5).map(movement => <div key={movement.id} className="flex justify-between gap-3 border-t border-[#6b686d]/10 py-2 text-xs"><span className="text-[#3b3733]">{movement.details}</span><span className="shrink-0 text-[#6b686d]">{new Date(movement.timestamp).toLocaleString()}</span></div>)}
            {inventoryService.getMovements(tenantId).length === 0 && <p className="text-xs text-[#6b686d]">Aún no hay movimientos registrados.</p>}
          </div>
        </section>
      </div>
    </div>
  );
};
