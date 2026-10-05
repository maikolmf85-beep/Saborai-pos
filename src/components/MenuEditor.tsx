import React, { useState } from 'react';
import { TenantInfo, MenuItem, TaxRegime, SubscriptionPlan } from '../types';
import { Sparkles, Plus, Edit2, Trash2, Search, UtensilsCrossed, ShieldAlert, ArrowLeft, ChevronDown, CheckCircle2, Settings2, UploadCloud, X, ListPlus, Clock } from 'lucide-react';
import { soundService } from '../services/soundEffects';

interface MenuEditorProps {
  menuItems: MenuItem[];
  onUpdateMenu: (items: MenuItem[]) => void;
  taxRegime: TaxRegime;
  plan: SubscriptionPlan;
  tenant: TenantInfo;
  onUpdateTenant: (tenant: TenantInfo) => void;
}

export const MenuEditor: React.FC<MenuEditorProps> = ({ menuItems, onUpdateMenu, taxRegime, plan, tenant, onUpdateTenant }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todas');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  
  // Custom categories management
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Magical AI generation state
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Bulk Add State
  const [isBulkAddOpen, setIsBulkAddOpen] = useState(false);
  const [bulkItems, setBulkItems] = useState<Array<{ name: string; price: number; category: string; station: 'Cocina' | 'Bar' | 'Postres' }>>([
    { name: '', price: 0, category: 'Platos Fuertes', station: 'Cocina' }
  ]);

  const handleAddBulkRow = () => {
    setBulkItems([...bulkItems, { name: '', price: 0, category: 'Platos Fuertes', station: 'Cocina' }]);
  };

  const handleUpdateBulkItem = (index: number, field: string, value: any) => {
    const updated = [...bulkItems];
    updated[index] = { ...updated[index], [field]: value };
    setBulkItems(updated);
  };

  const handleRemoveBulkRow = (index: number) => {
    const updated = bulkItems.filter((_, i) => i !== index);
    setBulkItems(updated);
  };

  const handleSaveBulk = () => {
    const validItems = bulkItems.filter(b => b.name.trim() !== '');
    if (validItems.length === 0) return;

    const newItems: MenuItem[] = validItems.map((item, index) => ({
      id: `item_${Date.now()}_bulk${index}`,
      name: item.name,
      description: '',
      price: item.price,
      category: item.category,
      station: item.station,
      cabysCode: '0000000000000',
      taxRate: taxRegime === 'SIMPLIFIED' ? 0 : 0.13,
      available: true,
      imageIcon: '🍽️',
      ingredients: []
    }));

    onUpdateMenu([...newItems, ...menuItems]);
    setIsBulkAddOpen(false);
    setBulkItems([{ name: '', price: 0, category: tenant.menuCategories?.[0] || 'Platos Fuertes', station: 'Cocina' }]);
    soundService.playSuccessChime();
  };

  const dynamicCategories = tenant.menuCategories && tenant.menuCategories.length > 0 
    ? tenant.menuCategories 
    : ['Platos Fuertes', 'Bebidas', 'Postres'];

  const categories = ['Todas', ...dynamicCategories];

  const filteredItems = menuItems.filter(item => {
    const matchesCategory = activeCategory === 'Todas' || item.category === activeCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleOpenEdit = (item?: MenuItem) => {
    soundService.playKeyClickSound();
    if (item) {
      setEditingItem(item);
    } else {
      setEditingItem({
        id: `item_${Date.now()}`,
        name: '',
        description: '',
        price: 0,
        category: categories.length > 1 ? categories[1] : 'Platos Fuertes',
        station: 'Cocina',
        cabysCode: '0000000000000',
        taxRate: taxRegime === 'SIMPLIFIED' ? 0 : 0.13,
        available: true,
        imageIcon: '🍽️',
        ingredients: []
      });
    }
    setIsEditing(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    soundService.playSuccessChime();
    
    if (!editingItem || !editingItem.name || !editingItem.id) return;
    
    let updatedMenu;
    const exists = menuItems.some(m => m.id === editingItem.id);
    
    if (exists) {
      updatedMenu = menuItems.map(m => m.id === editingItem.id ? editingItem as MenuItem : m);
    } else {
      updatedMenu = [editingItem as MenuItem, ...menuItems];
    }
    
    onUpdateMenu(updatedMenu);
    setIsEditing(false);
    setEditingItem(null);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este platillo del menú?')) {
      const updatedMenu = menuItems.filter(m => m.id !== id);
      onUpdateMenu(updatedMenu);
    }
  };

  const handleMagicWand = () => {
    if (!editingItem?.name) return;
    
    setIsGenerating(true);
    soundService.playNewOrderSound('Cocina'); // Fun sound
    
    setTimeout(() => {
      const adjectives = ['Delicioso', 'Exquisito', 'Auténtico', 'Premium', 'Irresistible'];
      const suffixes = ['preparado con los ingredientes más frescos.', 'ideal para compartir.', 'con el toque secreto de la casa.', 'una experiencia culinaria única.'];
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const suf = suffixes[Math.floor(Math.random() * suffixes.length)];
      
      setEditingItem(prev => ({
        ...prev!,
        description: `${adj} ${prev?.name?.toLowerCase()}, ${suf}`
      }));
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden animate-in fade-in duration-300 relative">
      {/* Header */}
      <div className="px-6 py-5 border-b border-stone-200 bg-stone-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-black text-stone-900 flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-[#588157]" />
            Catálogo y Menú
          </h2>
          <p className="text-xs text-stone-500 mt-1 font-medium">
            Agrega, edita o elimina platillos y bebidas. Estos se reflejarán instantáneamente en las mesas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar platillo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 w-full sm:w-64 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
            />
          </div>
          <button
            onClick={() => setIsBulkAddOpen(true)}
            className="px-4 py-2 bg-stone-100 text-stone-700 border border-stone-200 rounded-xl text-xs font-bold hover:bg-stone-200 transition-all flex items-center gap-2 shadow-xs shrink-0"
            title="Agrega múltiples productos al mismo tiempo."
          >
            <ListPlus className="w-4 h-4 text-[#588157]" />
            <span className="hidden sm:inline">Varios</span>
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="px-4 py-2 bg-stone-100 text-stone-700 border border-stone-200 rounded-xl text-xs font-bold hover:bg-stone-200 transition-all flex items-center gap-2 shadow-xs shrink-0"
            title="Administrar categorías"
          >
            <Settings2 className="w-4 h-4 text-[#588157]" />
            <span className="hidden sm:inline">Categorías</span>
          </button>
          <button
            onClick={() => handleOpenEdit()}
            className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800 transition-all flex items-center gap-2 shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4 text-[#a9b994]" />
            <span>Nuevo Platillo</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Categories Sidebar */}
        <div className="w-48 shrink-0 bg-stone-50 border-r border-stone-200 overflow-y-auto hidden md:block p-4">
          <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-3">Categorías</h3>
          <div className="space-y-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeCategory === cat 
                    ? 'bg-stone-200 text-stone-900 shadow-2xs' 
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#fafaf9]">
          
          <div className="md:hidden flex overflow-x-auto gap-2 pb-4 mb-4 border-b border-stone-200 no-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                  activeCategory === cat 
                    ? 'bg-stone-900 text-white shadow-md' 
                    : 'bg-white border border-stone-200 text-stone-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredItems.map(item => (
              <div key={item.id} className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col justify-between hover:border-[#a9b994] transition-all hover:shadow-md group">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-3xl">{item.imageIcon}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 uppercase tracking-wider">
                      {item.category}
                    </span>
                  </div>
                  <h4 className="font-black text-stone-900 text-sm leading-tight mt-3">{item.name}</h4>
                  <p className="text-[10px] text-stone-500 mt-1 line-clamp-2 leading-relaxed">
                    {item.description || 'Sin descripción'}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between">
                  <span className="font-black text-emerald-700">₡{item.price.toLocaleString()}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleOpenEdit(item)}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                      title="Editar Platillo"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Eliminar Platillo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="col-span-full py-12 flex flex-col items-center justify-center text-stone-400 border-2 border-dashed border-stone-200 rounded-2xl">
                <UtensilsCrossed className="w-12 h-12 mb-3 text-stone-300" />
                <p className="font-bold">No hay platillos en esta categoría</p>
                <p className="text-xs mt-1">Haz clic en "Nuevo Platillo" para empezar a construir tu menú.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-over Edit Form Modal */}
      {isEditing && editingItem && (
        <div className="absolute inset-0 z-50 flex bg-stone-950/20 backdrop-blur-xs justify-end animate-in fade-in">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
              <h3 className="font-black text-stone-900 text-lg flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-[#588157]" />
                {editingItem.name ? 'Editar Platillo' : 'Nuevo Platillo'}
              </h3>
              <button
                onClick={() => setIsEditing(false)}
                className="p-2 rounded-xl hover:bg-stone-200 text-stone-500 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <form id="menu-form" onSubmit={handleSave} className="space-y-5">
                
                {/* Icon & Name Row */}
                <div className="flex gap-4">
                  <div className="w-16">
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Icono</label>
                    <input
                      type="text"
                      required
                      value={editingItem.imageIcon || ''}
                      onChange={e => setEditingItem({...editingItem, imageIcon: e.target.value})}
                      className="w-full text-2xl text-center px-0 py-2 border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Nombre del Platillo</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Hamburguesa Clásica"
                      value={editingItem.name || ''}
                      onChange={e => setEditingItem({...editingItem, name: e.target.value})}
                      className="w-full px-3 py-2.5 text-sm font-bold border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    />
                  </div>
                </div>

                {/* Description with Magic Wand */}
                <div>
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-[10px] font-bold text-stone-500 uppercase">Descripción</label>
                    <button
                      type="button"
                      onClick={handleMagicWand}
                      disabled={isGenerating || !editingItem.name}
                      className="flex items-center gap-1 text-[9px] font-bold uppercase text-[#a9b994] hover:text-[#588157] transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? <span className="animate-pulse">Generando...</span> : <><Sparkles className="w-3 h-3" /> Auto-Completar con IA</>}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Descripción atractiva para el menú..."
                    value={editingItem.description || ''}
                    onChange={e => setEditingItem({...editingItem, description: e.target.value})}
                    className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all resize-none"
                  />
                </div>

                {/* Price and Category */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Precio (₡)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={editingItem.price === 0 ? '' : editingItem.price}
                      onChange={e => setEditingItem({...editingItem, price: parseFloat(e.target.value) || 0})}
                      className="w-full px-3 py-2 text-sm font-black border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Categoría</label>
                    <div className="relative">
                      <select
                        required
                        value={editingItem.category || ''}
                        onChange={e => setEditingItem({...editingItem, category: e.target.value})}
                        className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all appearance-none"
                      >
                        <option value="" disabled>Seleccione una...</option>
                        {Array.from(new Set([
                          ...(editingItem.category && !dynamicCategories.includes(editingItem.category) ? [editingItem.category] : []),
                          ...dynamicCategories
                        ])).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ChevronDown className="w-4 h-4 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Station, Taxes, and Prep Time */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-stone-100">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Estación (KDS)</label>
                    <select
                      value={editingItem.station || 'Cocina'}
                      onChange={e => setEditingItem({...editingItem, station: e.target.value as 'Cocina'|'Bar'})}
                      className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    >
                      <option value="Cocina">Cocina</option>
                      <option value="Bar">Bar</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Impuesto (IVA)</label>
                    <select
                      value={editingItem.taxRate || 0}
                      onChange={e => setEditingItem({...editingItem, taxRate: parseFloat(e.target.value)})}
                      className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                    >
                      {taxRegime === 'SIMPLIFIED' ? (
                        <option value={0}>Régimen Simplificado (0%)</option>
                      ) : (
                        <>
                          <option value={0.13}>General (13%)</option>
                          <option value={0.08}>Canasta/Rest. Reducido (8%)</option>
                          <option value={0.04}>Boletería (4%)</option>
                          <option value={0.01}>Básico (1%)</option>
                          <option value={0}>Exento (0%)</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 relative overflow-hidden group/prep">
                    <div className="absolute top-0 right-0 p-1 opacity-10 group-hover/prep:opacity-20 transition-opacity">
                      <Clock className="w-12 h-12 text-amber-600" />
                    </div>
                    <label className="block text-[10px] font-black text-amber-800 uppercase mb-1 relative z-10 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Tiempo Prep. (Min)
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Opcional (Ej: 15)"
                      value={editingItem.prepTime || ''}
                      onChange={e => setEditingItem({...editingItem, prepTime: parseInt(e.target.value) || 0})}
                      className="w-full px-3 py-1.5 text-sm font-black bg-white/80 border border-amber-300 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all relative z-10 text-amber-900 placeholder:text-amber-300"
                    />
                  </div>
                </div>

                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2 mt-4">
                  <ShieldAlert className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-800 leading-tight">
                    El código CABYS es un requisito del Ministerio de Hacienda. Saborai AI asignará el código correcto automáticamente en segundo plano cuando guardes.
                  </p>
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-stone-200 bg-stone-50">
              <button
                type="submit"
                form="menu-form"
                className="w-full py-3.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5 text-[#a9b994]" />
                Guardar Platillo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Products Modal */}
      {isBulkAddOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl relative">
            <div className="p-6 border-b border-stone-200 bg-stone-50 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-xl font-black text-stone-900 flex items-center gap-2">
                  <ListPlus className="w-6 h-6 text-[#588157]" />
                  Carga Múltiple de Productos
                </h3>
                <p className="text-xs text-stone-500 mt-1">
                  Añade varios productos al catálogo al mismo tiempo de manera ágil.
                </p>
              </div>
              <button 
                onClick={() => setIsBulkAddOpen(false)} 
                className="p-2 rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-white custom-scrollbar">
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3 pb-2 border-b border-stone-200 text-xs font-bold text-stone-500 uppercase px-2">
                  <div className="col-span-5">Nombre del Producto</div>
                  <div className="col-span-2">Precio (₡)</div>
                  <div className="col-span-2">Categoría</div>
                  <div className="col-span-2">Estación</div>
                  <div className="col-span-1 text-center">Acción</div>
                </div>

                {bulkItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-3 items-center bg-stone-50 p-2 rounded-xl border border-stone-200">
                    <div className="col-span-5">
                      <input
                        type="text"
                        placeholder="Ej: Hamburguesa Clásica"
                        value={item.name}
                        onChange={(e) => handleUpdateBulkItem(index, 'name', e.target.value)}
                        className="w-full px-3 py-2 text-sm font-bold border border-stone-300 rounded-lg focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994]"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Precio"
                        value={item.price || ''}
                        onChange={(e) => handleUpdateBulkItem(index, 'price', Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 text-sm font-bold border border-stone-300 rounded-lg focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994]"
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={item.category}
                        onChange={(e) => handleUpdateBulkItem(index, 'category', e.target.value)}
                        className="w-full px-3 py-2 text-sm font-bold border border-stone-300 rounded-lg focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] bg-white"
                      >
                        {dynamicCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <select
                        value={item.station}
                        onChange={(e) => handleUpdateBulkItem(index, 'station', e.target.value)}
                        className="w-full px-3 py-2 text-sm font-bold border border-stone-300 rounded-lg bg-white focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994]"
                      >
                        <option value="Cocina">Cocina</option>
                        <option value="Bar">Bar</option>
                        <option value="Postres">Postres/Cafetería</option>
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => handleRemoveBulkRow(index)}
                        className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar fila"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddBulkRow}
                className="mt-4 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold border border-stone-300 rounded-xl flex items-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4 text-[#588157]" />
                Añadir Fila
              </button>
            </div>

            <div className="p-6 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-3 shrink-0">
              <button
                onClick={() => setIsBulkAddOpen(false)}
                className="px-6 py-2.5 bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 rounded-xl text-sm font-bold transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveBulk}
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-sm font-black transition-all shadow-md flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-[#a9b994]" />
                Guardar Productos ({bulkItems.filter(b => b.name.trim() !== '').length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Management Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-stone-200">
            <div className="p-5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-stone-900 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-[#588157]" />
                  Categorías de Menú
                </h3>
                <p className="text-xs text-stone-500 mt-1">
                  Administra las categorías de tus platillos y bebidas.
                </p>
              </div>
              <button onClick={() => setIsCategoryModalOpen(false)} className="w-8 h-8 rounded-full bg-white border border-stone-200 flex items-center justify-center text-stone-500 hover:bg-stone-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
              <form onSubmit={(e) => {
                e.preventDefault();
                const trimmed = newCategoryName.trim();
                if (trimmed && !dynamicCategories.includes(trimmed)) {
                  onUpdateTenant({
                    ...tenant,
                    menuCategories: [...dynamicCategories, trimmed]
                  });
                  setNewCategoryName('');
                }
              }} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nueva categoría (ej. Ensaladas)"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#588157]"
                />
                <button type="submit" className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800">
                  Añadir
                </button>
              </form>

              <div className="space-y-2 mt-4">
                {dynamicCategories.map(cat => (
                  <div key={cat} className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-xl">
                    <span className="text-sm font-bold text-stone-700">{cat}</span>
                    <button
                      onClick={() => {
                        if (window.confirm(`¿Seguro que deseas eliminar la categoría "${cat}"? Los platillos seguirán existiendo pero debes reasignarlos.`)) {
                          onUpdateTenant({
                            ...tenant,
                            menuCategories: dynamicCategories.filter(c => c !== cat)
                          });
                        }
                      }}
                      className="w-8 h-8 rounded-full hover:bg-red-50 text-stone-400 hover:text-red-500 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

