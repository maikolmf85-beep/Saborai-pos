import React, { useState } from 'react';
import { MenuItem, TaxRegime } from '../types';
import { Sparkles, Plus, Edit2, Trash2, Search, UtensilsCrossed, ShieldAlert, ArrowLeft, ChevronDown, CheckCircle2, Settings2 } from 'lucide-react';
import { soundService } from '../services/soundEffects';

interface MenuEditorProps {
  menuItems: MenuItem[];
  onUpdateMenu: (items: MenuItem[]) => void;
  taxRegime: TaxRegime;
}

export const MenuEditor: React.FC<MenuEditorProps> = ({ menuItems, onUpdateMenu, taxRegime }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todas');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  
  // Magical AI generation state
  const [isGenerating, setIsGenerating] = useState(false);

  const categories = ['Todas', ...Array.from(new Set(menuItems.map(m => m.category)))];

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
                      <input
                        type="text"
                        required
                        list="categories-list"
                        value={editingItem.category || ''}
                        onChange={e => setEditingItem({...editingItem, category: e.target.value})}
                        className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
                      />
                      <datalist id="categories-list">
                        {categories.filter(c => c !== 'Todas').map(c => <option key={c} value={c} />)}
                      </datalist>
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

                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase mb-1">Tiempo Prep. (Min)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Ej: 15"
                      value={editingItem.prepTime || ''}
                      onChange={e => setEditingItem({...editingItem, prepTime: parseInt(e.target.value) || 0})}
                      className="w-full px-3 py-2 text-sm font-black border border-stone-200 rounded-xl focus:border-[#a9b994] focus:ring-1 focus:ring-[#a9b994] transition-all"
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
    </div>
  );
};
