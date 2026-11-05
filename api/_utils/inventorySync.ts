import { cloudIngredientId, cloudMenuItemId, localIngredientId, normalizeInventoryName } from './inventoryIds.js';

function cleanText(value: unknown, maxLength: number, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validateArray(value: unknown, label: string, maxLength: number): any[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`La lista de ${label} no es válida.`);
  return value;
}

export async function saveInventoryConfig(
  supabase: any,
  tenantId: string,
  branchId: string,
  payload: any
): Promise<{ catalog: Array<Record<string, unknown>>; ingredientCount: number; recipeCount: number }> {
  const ingredients = validateArray(payload?.ingredients, 'insumos', 500);
  const menuItems = validateArray(payload?.menuItems, 'productos', 1000);
  const seenNames = new Set<string>();
  const seenLocalIds = new Set<string>();
  const ingredientByLocalId = new Map<string, { cloudId: string; name: string; unit: string; localId: string }>();
  const cleanIngredients = ingredients.map(raw => {
    const name = cleanText(raw?.name, 120);
    const unit = cleanText(raw?.unit, 24);
    const localId = cleanText(raw?.id, 200) || localIngredientId(name);
    const nameKey = normalizeInventoryName(name);
    if (!name || !unit || !nameKey) throw new Error('Cada insumo debe tener nombre y unidad.');
    if (seenNames.has(nameKey) || seenLocalIds.has(localId)) throw new Error(`El insumo "${name}" está duplicado en el catálogo.`);
    seenNames.add(nameKey);
    seenLocalIds.add(localId);
    const ingredient = {
      localId,
      cloudId: cloudIngredientId(tenantId, branchId, localId),
      name,
      unit,
      minimumStock: Math.max(0, finiteNumber(raw?.minimumStock, 0)),
      currentStock: Math.max(0, finiteNumber(raw?.currentStock, 0))
    };
    ingredientByLocalId.set(localId, ingredient);
    return ingredient;
  });

  const seenMenuIds = new Set<string>();
  const menuMap = new Map<string, string>();
  const productRows = menuItems.map(raw => {
    const localId = cleanText(raw?.id, 200);
    const name = cleanText(raw?.name, 200);
    if (!localId || !name || seenMenuIds.has(localId)) throw new Error('Hay productos duplicados o sin id/nombre.');
    seenMenuIds.add(localId);
    const cloudId = cloudMenuItemId(tenantId, branchId, localId);
    menuMap.set(localId, cloudId);
    const station = ['Cocina', 'Bar', 'Postres'].includes(raw?.station) ? raw.station : 'Cocina';
    return {
      id: cloudId,
      tenant_id: tenantId,
      branch_id: branchId,
      category_id: null,
      name,
      description: cleanText(raw?.description, 1000),
      price: Math.max(0, finiteNumber(raw?.price, 0)),
      tax_rate: Math.max(0, finiteNumber(raw?.taxRate, 0.13)),
      cabys_code: cleanText(raw?.cabysCode, 20) || null,
      station,
      prep_time_minutes: Math.max(0, Math.floor(finiteNumber(raw?.prepTime, 0))) || null,
      is_available: raw?.available !== false,
      modifiers: Array.isArray(raw?.modifiers) ? raw.modifiers.slice(0, 50) : []
    };
  });

  const recipeRows: Array<Record<string, unknown>> = [];
  for (const rawProduct of menuItems) {
    const localMenuId = cleanText(rawProduct?.id, 200);
    const cloudMenuId = menuMap.get(localMenuId);
    if (!cloudMenuId) continue;
    const recipe = validateArray(rawProduct?.ingredients ?? [], 'ingredientes de receta', 200);
    const seenRecipeIngredients = new Set<string>();
    for (const rawRecipe of recipe) {
      const localId = cleanText(rawRecipe?.ingredientId, 200) || localIngredientId(rawRecipe?.name);
      const ingredient = ingredientByLocalId.get(localId)
        || [...ingredientByLocalId.values()].find(item => normalizeInventoryName(item.name) === normalizeInventoryName(rawRecipe?.name));
      const quantity = finiteNumber(rawRecipe?.requiredQty, 0);
      if (!ingredient || quantity <= 0 || !Number.isFinite(quantity)) throw new Error(`La receta de "${cleanText(rawProduct?.name, 120)}" contiene un insumo o cantidad inválida.`);
      if (seenRecipeIngredients.has(ingredient.cloudId)) throw new Error(`La receta de "${cleanText(rawProduct?.name, 120)}" repite el insumo "${ingredient.name}".`);
      seenRecipeIngredients.add(ingredient.cloudId);
      recipeRows.push({
        tenant_id: tenantId,
        menu_item_id: cloudMenuId,
        ingredient_id: ingredient.cloudId,
        quantity,
        unit: ingredient.unit
      });
    }
  }

  for (const ingredient of cleanIngredients) {
    const existing = await supabase.from('pos_ingredients')
      .select('id, unit, current_stock')
      .eq('id', ingredient.cloudId)
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .maybeSingle();
    if (existing.error) throw new Error('No se pudo verificar el insumo en la nube.');

    if (existing.data) {
      if (existing.data.unit !== ingredient.unit && Number(existing.data.current_stock) > 0) {
        throw new Error(`No se puede cambiar la unidad de "${ingredient.name}" mientras tenga existencias.`);
      }
      const update = await supabase.from('pos_ingredients').update({
        name: ingredient.name,
        unit: ingredient.unit,
        minimum_stock: ingredient.minimumStock,
        is_active: true
      }).eq('id', ingredient.cloudId).eq('tenant_id', tenantId).eq('branch_id', branchId);
      if (update.error) throw new Error('No se pudo actualizar el catálogo de insumos.');
    } else {
      const insert = await supabase.from('pos_ingredients').insert({
        id: ingredient.cloudId,
        tenant_id: tenantId,
        branch_id: branchId,
        name: ingredient.name,
        unit: ingredient.unit,
        current_stock: ingredient.currentStock,
        minimum_stock: ingredient.minimumStock,
        is_active: true
      });
      if (insert.error) throw new Error('No se pudo crear el insumo en la nube.');
    }
  }

  if (productRows.length > 0) {
    // Create missing rows for recipe foreign keys; never overwrite an existing menu price
    // or other operational fields from a potentially stale local snapshot.
    const upsert = await supabase.from('pos_menu_items').upsert(productRows, { onConflict: 'id', ignoreDuplicates: true });
    if (upsert.error) throw new Error('No se pudo sincronizar el menú para las recetas.');
  }

  const cloudMenuIds = [...menuMap.values()];
  if (cloudMenuIds.length > 0) {
    const removeOld = await supabase.from('pos_recipes').delete()
      .eq('tenant_id', tenantId)
      .in('menu_item_id', cloudMenuIds);
    if (removeOld.error) throw new Error('No se pudieron reemplazar las recetas en la nube.');
  }
  if (recipeRows.length > 0) {
    const insertRecipes = await supabase.from('pos_recipes').insert(recipeRows);
    if (insertRecipes.error) throw new Error('No se pudieron guardar las recetas en la nube.');
  }

  const cloudIngredientIds = [...ingredientByLocalId.values()].map(item => item.cloudId);
  let catalog: Array<Record<string, unknown>> = [];
  if (cloudIngredientIds.length > 0) {
    const stock = await supabase.from('pos_ingredients')
      .select('id, name, unit, current_stock, minimum_stock')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .in('id', cloudIngredientIds);
    if (stock.error) throw new Error('No se pudo verificar el stock sincronizado.');
    const localByCloudId = new Map([...ingredientByLocalId.values()].map(item => [item.cloudId, item.localId]));
    catalog = (stock.data || []).map((row: any) => ({
      id: localByCloudId.get(row.id) || localIngredientId(row.name),
      name: row.name,
      unit: row.unit,
      currentStock: Number(row.current_stock) || 0,
      minimumStock: Number(row.minimum_stock) || 0
    }));
  }

  return { catalog, ingredientCount: catalog.length, recipeCount: recipeRows.length };
}

export async function loadInventoryConfig(
  supabase: any,
  tenantId: string,
  branchId: string,
  payload: any
): Promise<{ catalog: Array<Record<string, unknown>>; recipesByMenuItemId: Record<string, Array<Record<string, unknown>>> }> {
  const localMenuItemIds = validateArray(payload?.menuItemIds ?? [], 'ids de menú', 1000)
    .map(value => cleanText(value, 200)).filter(Boolean);
  const localToCloud = new Map(localMenuItemIds.map(localId => [localId, cloudMenuItemId(tenantId, branchId, localId)]));
  const cloudMenuIds = [...localToCloud.values()];
  const ingredientsResult = await supabase.from('pos_ingredients')
    .select('id, name, unit, current_stock, minimum_stock')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (ingredientsResult.error) throw new Error('No se pudo cargar el catálogo de insumos.');

  const catalog = (ingredientsResult.data || []).map((row: any) => ({
    id: localIngredientId(row.name),
    name: row.name,
    unit: row.unit,
    currentStock: Number(row.current_stock) || 0,
    minimumStock: Number(row.minimum_stock) || 0
  }));
  const ingredientById = new Map((ingredientsResult.data || []).map((row: any) => [row.id, row]));
  const recipesByMenuItemId: Record<string, Array<Record<string, unknown>>> = {};

  if (cloudMenuIds.length > 0) {
    const menuResult = await supabase.from('pos_menu_items').select('id')
      .eq('tenant_id', tenantId).eq('branch_id', branchId).in('id', cloudMenuIds);
    if (menuResult.error) throw new Error('No se pudo verificar el menú en la nube.');
    const cloudToLocal = new Map([...localToCloud.entries()].map(([localId, cloudId]) => [cloudId, localId]));
    for (const row of menuResult.data || []) {
      const localId = cloudToLocal.get(row.id);
      if (localId) recipesByMenuItemId[localId] = [];
    }
    if (menuResult.data?.length) {
      const recipeResult = await supabase.from('pos_recipes')
        .select('menu_item_id, ingredient_id, quantity, unit')
        .eq('tenant_id', tenantId)
        .in('menu_item_id', menuResult.data.map((row: any) => row.id));
      if (recipeResult.error) throw new Error('No se pudieron cargar las recetas de la nube.');
      for (const recipe of recipeResult.data || []) {
        const localMenuId = cloudToLocal.get(recipe.menu_item_id);
        const ingredient: any = ingredientById.get(recipe.ingredient_id);
        if (!localMenuId || !ingredient) continue;
        (recipesByMenuItemId[localMenuId] ||= []).push({
          ingredientId: localIngredientId(ingredient.name),
          name: ingredient.name,
          unit: recipe.unit || ingredient.unit,
          requiredQty: Number(recipe.quantity) || 0,
          currentStock: Number(ingredient.current_stock) || 0
        });
      }
    }
  }
  return { catalog, recipesByMenuItemId };
}

export async function adjustInventoryStock(
  supabase: any,
  tenantId: string,
  branchId: string,
  userId: string,
  operationId: string,
  payload: any
): Promise<Record<string, unknown>> {
  const localId = cleanText(payload?.ingredientId, 200);
  const name = cleanText(payload?.name, 120);
  const adjustment = finiteNumber(payload?.adjustment, 0);
  if (!localId || !name || !adjustment || Math.abs(adjustment) > 100000000) throw new Error('El ajuste de inventario no es válido.');
  const ingredientId = cloudIngredientId(tenantId, branchId, localId);
  const rpc = await supabase.rpc('apply_inventory_adjustment', {
    p_tenant_id: tenantId,
    p_operation_id: operationId,
    p_created_by: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ? userId : null,
    p_branch_id: branchId,
    p_ingredient_id: ingredientId,
    p_adjustment: adjustment,
    p_reason: cleanText(payload?.reason, 300, 'Ajuste de inventario')
  });
  if (rpc.error) throw new Error('No se pudo ajustar el stock remoto; la sincronización queda pendiente.');
  return { ingredientId: localId, name, ...rpc.data };
}
