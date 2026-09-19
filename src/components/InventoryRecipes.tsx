import React, { useState } from 'react';
import { MenuItem } from '../types';
import { sampleMenuItems } from '../data/mockData';
import { 
  Boxes, 
  AlertTriangle, 
  Sparkles, 
  Scale, 
  ChevronRight, 
  Plus, 
  CheckCircle2, 
  TrendingDown,
  Layers
} from 'lucide-react';

export const InventoryRecipes: React.FC = () => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>(sampleMenuItems);
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(sampleMenuItems.length > 0 ? sampleMenuItems[0] : null);
  const [wasteQty, setWasteQty] = useState<number>(0);
  const [wasteReason, setWasteReason] = useState<string>('Vencimiento / Merma natural');
  const [recordedWasteSuccess, setRecordedWasteSuccess] = useState(false);

  const handleRecordWaste = (e: React.FormEvent) => {
    e.preventDefault();
    if (wasteQty <= 0) return;
    setRecordedWasteSuccess(true);
    setTimeout(() => {
      setRecordedWasteSuccess(false);
      setWasteQty(0);
    }, 2000);
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1700px] mx-auto space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#6b686d]/15">
        <div>
          <h2 className="text-2xl font-black text-[#3b3733]">Control Automático de Inventario & Escandallos</h2>
          <p className="text-xs text-[#6b686d]">
            Descuento exacto de insumos en tiempo real por cada platillo facturado y registro de mermas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3.5 py-1.5 rounded-2xl bg-[#a9b994]/20 border border-[#a9b994]/40 text-xs font-bold text-[#3b3733] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#3b3733]" />
            <span>Auditoría Predictiva IA Activa</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Product List & Current Stock (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <h3 className="font-bold text-sm text-[#3b3733] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#a9b994]" />
            <span>Recetario & Fichas Técnicas</span>
          </h3>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {menuItems.length === 0 ? (
              <div className="p-6 text-center text-[#6b686d] text-sm border-2 border-dashed border-[#6b686d]/20 rounded-3xl">
                No hay productos en el menú aún. Crea uno nuevo para configurar sus recetas.
              </div>
            ) : menuItems.map((prod) => {
              const isSelected = selectedProduct?.id === prod.id;
              const hasLowStock = prod.ingredients.some(ing => ing.currentStock < 1000);

              return (
                <div
                  key={prod.id}
                  onClick={() => setSelectedProduct(prod)}
                  className={`p-4 rounded-3xl border-2 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#3b3733] bg-[#fcfeff] shadow-md ring-2 ring-[#3b3733]/20'
                      : 'border-[#6b686d]/20 bg-[#fcfeff] hover:border-[#a9b994]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl p-2 rounded-2xl bg-[#a9b994]/20">{prod.imageIcon}</span>
                      <div>
                        <h4 className="font-bold text-sm text-[#3b3733]">{prod.name}</h4>
                        <p className="text-xs text-[#6b686d]">Categoría: {prod.category} • {prod.ingredients.length} Ingredientes</p>
                      </div>
                    </div>
                    <span className="font-black text-xs text-[#3b3733]">₡{prod.price.toLocaleString()}</span>
                  </div>

                  {hasLowStock && (
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-xl">
                      <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>Insumos críticos requieren reabastecimiento pronto</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Recipe Breakdown & Stock Subtraction Formula (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {selectedProduct ? (
            <div className="p-6 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 shadow-sm space-y-5">
              <div className="flex items-start justify-between pb-4 border-b border-[#6b686d]/15">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a9b994]">Escandallo de Platillo</span>
                  <h3 className="text-xl font-black text-[#3b3733] flex items-center gap-2">
                    <span>{selectedProduct.imageIcon}</span>
                    <span>{selectedProduct.name}</span>
                  </h3>
                  <p className="text-xs text-[#6b686d] mt-1">{selectedProduct.description}</p>
                </div>

                <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#3b3733] text-[#fcfeff]">
                  Estación: {selectedProduct.station}
                </span>
              </div>

              {/* Ingredients table */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#3b3733]">
                  Fórmula de Insumos Descontados por Cada Venta:
                </h4>

                <div className="space-y-2">
                  {selectedProduct.ingredients.map((ing, idx) => (
                    <div key={idx} className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-[#3b3733] block">{ing.name}</span>
                        <span className="text-[11px] text-[#6b686d]">
                          Descuento por ración: <strong className="text-[#3b3733]">{ing.requiredQty} {ing.unit}</strong>
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-bold uppercase text-[#6b686d] block">Stock Disponible:</span>
                        <span className={`font-black text-xs ${ing.currentStock < 1000 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {ing.currentStock.toLocaleString()} {ing.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Waste recording form */}
              <div className="pt-4 border-t border-[#6b686d]/15 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#3b3733] flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-red-600" />
                  <span>Registrar Merma Directa</span>
                </h4>

                <form onSubmit={handleRecordWaste} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b686d] uppercase mb-1">Cantidad / Porciones</label>
                    <input
                      type="number"
                      min="1"
                      value={wasteQty || ''}
                      onChange={(e) => setWasteQty(Number(e.target.value))}
                      placeholder="1"
                      className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#6b686d] uppercase mb-1">Motivo de Merma</label>
                    <select
                      value={wasteReason}
                      onChange={(e) => setWasteReason(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#6b686d]/25 text-xs text-[#3b3733] bg-white"
                    >
                      <option value="Vencimiento">Vencimiento de Insumo</option>
                      <option value="Accidente">Accidente en Cocina</option>
                      <option value="Calidad">No cumple estándar de calidad</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-2 bg-[#3b3733] text-[#fcfeff] rounded-xl text-xs font-bold hover:bg-[#25221f] transition-all"
                    >
                      {recordedWasteSuccess ? '¡Merma Asentada!' : 'Asentar Merma'}
                    </button>
                  </div>
                </form>
              </div>

            </div>
          ) : (
            <div className="p-6 rounded-3xl bg-[#fcfeff] border border-[#6b686d]/20 shadow-sm flex items-center justify-center h-64 text-[#6b686d] text-sm">
              Selecciona un producto para ver su receta o agrega productos en el Punto de Venta.
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
