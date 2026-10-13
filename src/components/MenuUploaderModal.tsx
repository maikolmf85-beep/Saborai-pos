import React, { useState, useRef } from 'react';
import { 
  Sparkles, 
  UploadCloud, 
  FileText, 
  Image as ImageIcon, 
  X, 
  Check, 
  Trash2, 
  Plus, 
  AlertCircle, 
  Loader2, 
  CheckCircle2, 
  ArrowLeft,
  DollarSign,
  Utensils,
  Layers,
  Edit3
} from 'lucide-react';
import { MenuItem, TaxRegime } from '../types';
import { soundService } from '../services/soundEffects';

export interface ExtractedProduct {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  categoria: string;
  selected: boolean;
}

export interface ExtractedCategory {
  nombre_categoria: string;
  productos: Array<{
    nombre: string;
    descripcion?: string;
    precio: number;
  }>;
}

interface MenuUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (importedItems: MenuItem[], newCategories: string[]) => void;
  taxRegime?: TaxRegime;
  existingCategories?: string[];
}

export const MenuUploaderModal: React.FC<MenuUploaderModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  taxRegime = 'TRADITIONAL',
  existingCategories = []
}) => {
  // Wizard steps: 'upload' | 'processing' | 'preview'
  const [step, setStep] = useState<'upload' | 'processing' | 'preview'>('upload');
  
  // Selected file state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Extracted data state
  const [extractedProducts, setExtractedProducts] = useState<ExtractedProduct[]>([]);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('Todas');
  const [newCatInput, setNewCatInput] = useState<string>('');
  const [showAddCatInput, setShowAddCatInput] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateAndSetFile = (file: File) => {
    setErrorMsg(null);
    const validMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(file.type) && !file.name.match(/\.(pdf|jpe?g|png|webp)$/i)) {
      setErrorMsg('Formato no soportado. Por favor sube un archivo PDF, JPG o PNG de tu menú.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('El archivo excede el tamaño máximo permitido de 20MB.');
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFilePreviewUrl(null);
    setStep('upload');
    setErrorMsg(null);
    setExtractedProducts([]);
  };

  const handleProcessFileWithAI = async () => {
    if (!selectedFile) return;

    setErrorMsg(null);
    setStep('processing');
    soundService.playKeyClickSound();

    try {
      // 1. Convert file to Base64
      const base64Promise = new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(selectedFile);
      });

      const fileDataUri = await base64Promise;

      // 2. Call backend endpoint /api/parse-menu
      const res = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileBase64: fileDataUri,
          mimeType: selectedFile.type || (selectedFile.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `Error del servidor (${res.status})`);
      }

      const data = await res.json();
      const categorias: ExtractedCategory[] = data.categorias || [];

      if (!Array.isArray(categorias) || categorias.length === 0) {
        throw new Error('No se detectaron platos ni categorías en el documento. Asegúrate de que el archivo sea legible e inténtalo nuevamente.');
      }

      // Flatten items into editable state
      const flattened: ExtractedProduct[] = [];
      let itemCounter = 0;

      categorias.forEach(cat => {
        const catName = (cat.nombre_categoria || 'Platos Fuertes').trim();
        (cat.productos || []).forEach(prod => {
          if (prod.nombre && prod.nombre.trim()) {
            itemCounter++;
            flattened.push({
              id: `ext_${Date.now()}_${itemCounter}`,
              nombre: prod.nombre.trim(),
              descripcion: prod.descripcion ? prod.descripcion.trim() : '',
              precio: typeof prod.precio === 'number' ? Math.max(0, prod.precio) : 0,
              categoria: catName,
              selected: true
            });
          }
        });
      });

      if (flattened.length === 0) {
        throw new Error('La IA analizó la carta pero no pudo estructurar productos legibles.');
      }

      setExtractedProducts(flattened);
      setStep('preview');
      soundService.playSuccessChime();
    } catch (err: any) {
      console.error('Error al procesar carta con IA:', err);
      setErrorMsg(err.message || 'Error inesperado al conectar con el servicio de IA.');
      setStep('upload');
    }
  };

  // Helper getters
  const distinctCategories = Array.from(new Set(extractedProducts.map(p => p.categoria)));
  const allAvailableCategories = Array.from(new Set([...existingCategories, ...distinctCategories]));

  const filteredProducts = activeCategoryFilter === 'Todas'
    ? extractedProducts
    : extractedProducts.filter(p => p.categoria === activeCategoryFilter);

  const selectedCount = extractedProducts.filter(p => p.selected).length;

  // Handlers for editable table
  const handleToggleSelectAll = (checked: boolean) => {
    setExtractedProducts(prev => prev.map(p => ({ ...p, selected: checked })));
  };

  const handleUpdateProduct = (id: string, field: keyof ExtractedProduct, val: any) => {
    setExtractedProducts(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, [field]: val };
      }
      return p;
    }));
  };

  const handleDeleteProduct = (id: string) => {
    setExtractedProducts(prev => prev.filter(p => p.id !== id));
  };

  const handleAddNewProductRow = (catName?: string) => {
    const targetCategory = catName || (activeCategoryFilter !== 'Todas' ? activeCategoryFilter : distinctCategories[0] || 'Platos Fuertes');
    const newProd: ExtractedProduct = {
      id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      nombre: '',
      descripcion: '',
      precio: 0,
      categoria: targetCategory,
      selected: true
    };
    setExtractedProducts(prev => [...prev, newProd]);
  };

  const handleAddCustomCategory = () => {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    if (!distinctCategories.includes(trimmed)) {
      handleAddNewProductRow(trimmed);
      setActiveCategoryFilter(trimmed);
    }
    setNewCatInput('');
    setShowAddCatInput(false);
  };

  const handleConfirmAndSaveToPOS = () => {
    const approvedProducts = extractedProducts.filter(p => p.selected && p.nombre.trim() !== '');
    if (approvedProducts.length === 0) {
      setErrorMsg('Debes seleccionar al menos un producto válido para importar al POS.');
      return;
    }

    // Determine station based on category name
    const guessStation = (cat: string, name: string): 'Cocina' | 'Bar' | 'Postres' => {
      const lower = `${cat} ${name}`.toLowerCase();
      if (lower.includes('bebida') || lower.includes('coctel') || lower.includes('cerveza') || lower.includes('trago') || lower.includes('vino') || lower.includes('café') || lower.includes('cafe') || lower.includes('jugo') || lower.includes('refresco') || lower.includes('smoothie')) {
        return 'Bar';
      }
      if (lower.includes('postre') || lower.includes('helado') || lower.includes('dulce') || lower.includes('reposter') || lower.includes('torta') || lower.includes('pastel')) {
        return 'Postres';
      }
      return 'Cocina';
    };

    // Build MenuItem objects
    const newMenuItems: MenuItem[] = approvedProducts.map((p, index) => ({
      id: `item_ai_${Date.now()}_${index}`,
      name: p.nombre.trim(),
      description: p.descripcion.trim(),
      price: Math.max(0, p.precio),
      category: p.categoria.trim(),
      station: guessStation(p.categoria, p.nombre),
      cabysCode: '0000000000000',
      taxRate: taxRegime === 'SIMPLIFIED' ? 0 : 0.13,
      available: true,
      imageIcon: guessStation(p.categoria, p.nombre) === 'Bar' ? '🍹' : guessStation(p.categoria, p.nombre) === 'Postres' ? '🍰' : '🍽️',
      ingredients: []
    }));

    // Detect new categories
    const newlyAddedCategories = distinctCategories.filter(c => !existingCategories.includes(c));

    soundService.playSuccessChime();
    onImportSuccess(newMenuItems, newlyAddedCategories);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-stone-200 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden relative">
        
        {/* Top Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-stone-900 tracking-tight flex items-center gap-2">
                <span>Carga Inteligente de Menú por IA</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Gemini 2.0 Flash
                </span>
              </h2>
              <p className="text-xs text-stone-500">
                Digitaliza tu carta física o digital (PDF / Imagen) en segundos.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500 hover:text-stone-800 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          
          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-800 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold block">No pudimos procesar el archivo:</span>
                <span>{errorMsg}</span>
              </div>
              <button 
                onClick={() => setErrorMsg(null)}
                className="text-red-500 hover:text-red-800 font-bold"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ==================== STEP 1: UPLOAD ==================== */}
          {step === 'upload' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              
              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                  isDragging 
                    ? 'border-emerald-500 bg-emerald-50/60 scale-[1.01]' 
                    : selectedFile
                    ? 'border-emerald-400 bg-emerald-50/20'
                    : 'border-stone-300 hover:border-emerald-500 hover:bg-stone-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                <div className="w-16 h-16 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-600 shadow-2xs group-hover:scale-105 transition-transform">
                  {selectedFile ? (
                    selectedFile.type === 'application/pdf' ? (
                      <FileText className="w-8 h-8 text-red-500" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-emerald-600" />
                    )
                  ) : (
                    <UploadCloud className="w-8 h-8 text-[#588157]" />
                  )}
                </div>

                {selectedFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-stone-900 flex items-center justify-center gap-2">
                      <span>{selectedFile.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-md bg-stone-200 text-stone-700">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </p>
                    <p className="text-xs text-emerald-700 font-semibold">
                      Archivo listo para analizar. Haz clic para cambiarlo si lo deseas.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 max-w-md">
                    <p className="text-sm font-bold text-stone-900">
                      Arrastra y suelta tu carta aquí, o <span className="text-emerald-700 underline">haz clic para examinar</span>
                    </p>
                    <p className="text-xs text-stone-500">
                      Soporta documentos <strong>PDF</strong>, o fotos en <strong>JPG, PNG, WEBP</strong> (hasta 20 MB).
                    </p>
                  </div>
                )}
              </div>

              {/* Preview image if image selected */}
              {filePreviewUrl && (
                <div className="flex items-center justify-center p-3 bg-stone-50 border border-stone-200 rounded-2xl">
                  <img
                    src={filePreviewUrl}
                    alt="Previsualización de carta"
                    className="max-h-48 rounded-xl object-contain shadow-xs"
                  />
                </div>
              )}

              {/* Instructions Pill Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-stone-600">
                <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100 flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 font-bold text-stone-700 flex items-center justify-center shrink-0 text-[10px]">1</span>
                  <span><strong>Sube tu menú:</strong> Puede ser una foto de tu carta física o un archivo PDF digital.</span>
                </div>
                <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100 flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 font-bold text-stone-700 flex items-center justify-center shrink-0 text-[10px]">2</span>
                  <span><strong>Extracción IA:</strong> Gemini detecta secciones, nombres, descripciones y precios.</span>
                </div>
                <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100 flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-stone-200 font-bold text-stone-700 flex items-center justify-center shrink-0 text-[10px]">3</span>
                  <span><strong>Revisa y guarda:</strong> Edita cualquier dato antes de enviarlo a tu inventario de Saborai.</span>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!selectedFile}
                  onClick={handleProcessFileWithAI}
                  className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-[#a9b994]" />
                  <span>Analizar Carta con IA</span>
                </button>
              </div>

            </div>
          )}

          {/* ==================== STEP 2: PROCESSING ==================== */}
          {step === 'processing' && (
            <div className="py-16 text-center space-y-4 animate-in fade-in duration-200">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-100 border-t-emerald-600 animate-spin" />
                <Sparkles className="w-8 h-8 text-emerald-600 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-stone-900">Analizando menú con IA...</h3>
                <p className="text-xs text-stone-500 max-w-sm mx-auto">
                  Gemini 2.0 Flash está procesando el archivo, agrupando categorías, recetas y precios estructurados.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 rounded-full text-[11px] font-semibold border border-emerald-200">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Extrayendo estructura del menú...</span>
              </div>
            </div>
          )}

          {/* ==================== STEP 3: PREVIEW & EDIT ==================== */}
          {step === 'preview' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Summary Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-stone-50 rounded-2xl border border-stone-200">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{extractedProducts.length} platos detectados</span>
                  </span>
                  <span className="text-stone-300">|</span>
                  <span className="text-xs text-stone-600 font-semibold">
                    {distinctCategories.length} categorías
                  </span>
                  <span className="text-stone-300">|</span>
                  <span className="text-xs text-emerald-700 font-bold">
                    {selectedCount} seleccionados para importar
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleSelectAll(selectedCount !== extractedProducts.length)}
                    className="text-[11px] font-bold text-stone-600 hover:text-stone-900 underline"
                  >
                    {selectedCount === extractedProducts.length ? 'Desmarcar todos' : 'Seleccionar todos'}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-3 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>Subir otro</span>
                  </button>
                </div>
              </div>

              {/* Category Filter Tabs & Add Category */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                <button
                  type="button"
                  onClick={() => setActiveCategoryFilter('Todas')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0 ${
                    activeCategoryFilter === 'Todas'
                      ? 'bg-stone-900 text-white shadow-2xs'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  Todas ({extractedProducts.length})
                </button>
                {distinctCategories.map(cat => {
                  const count = extractedProducts.filter(p => p.categoria === cat).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-colors shrink-0 flex items-center gap-1.5 ${
                        activeCategoryFilter === cat
                          ? 'bg-stone-900 text-white shadow-2xs'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      <span>{cat}</span>
                      <span className="text-[10px] opacity-75 font-normal">({count})</span>
                    </button>
                  );
                })}

                {/* Add new category button / input */}
                {showAddCatInput ? (
                  <div className="flex items-center gap-1 bg-white border border-stone-300 rounded-xl px-2 py-0.5 shrink-0">
                    <input
                      type="text"
                      placeholder="Nueva categoría..."
                      value={newCatInput}
                      onChange={(e) => setNewCatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomCategory(); }}
                      className="text-xs text-stone-800 outline-none w-28 font-medium"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomCategory}
                      className="p-1 text-emerald-700 hover:text-emerald-900"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddCatInput(false); setNewCatInput(''); }}
                      className="p-1 text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddCatInput(true)}
                    className="px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-xl font-bold shrink-0 flex items-center gap-1"
                    title="Añadir nueva categoría"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Categoría</span>
                  </button>
                )}
              </div>

              {/* Editable Table */}
              <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-stone-100/80 text-stone-600 sticky top-0 z-10 text-[11px] font-bold uppercase tracking-wider border-b border-stone-200">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={selectedCount > 0 && selectedCount === extractedProducts.length}
                            onChange={(e) => handleToggleSelectAll(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          />
                        </th>
                        <th className="py-2.5 px-3">Plato / Producto</th>
                        <th className="py-2.5 px-3">Descripción / Ingredientes</th>
                        <th className="py-2.5 px-3 w-28">Precio (₡)</th>
                        <th className="py-2.5 px-3 w-36">Categoría</th>
                        <th className="py-2.5 px-3 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredProducts.map((item) => (
                        <tr 
                          key={item.id}
                          className={`hover:bg-stone-50/80 transition-colors ${
                            !item.selected ? 'opacity-40 bg-stone-50/40' : ''
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={(e) => handleUpdateProduct(item.id, 'selected', e.target.checked)}
                              className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </td>

                          {/* Name Input */}
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.nombre}
                              onChange={(e) => handleUpdateProduct(item.id, 'nombre', e.target.value)}
                              placeholder="Nombre del plato..."
                              className="w-full font-bold text-stone-900 bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-600 focus:bg-white px-1.5 py-1 rounded transition-colors outline-none"
                            />
                          </td>

                          {/* Description Input */}
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.descripcion}
                              onChange={(e) => handleUpdateProduct(item.id, 'descripcion', e.target.value)}
                              placeholder="Descripción opcional..."
                              className="w-full text-stone-600 bg-transparent border-b border-transparent hover:border-stone-300 focus:border-emerald-600 focus:bg-white px-1.5 py-1 rounded transition-colors outline-none text-[11px]"
                            />
                          </td>

                          {/* Price Input */}
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1 border-b border-transparent hover:border-stone-300 focus-within:border-emerald-600 focus-within:bg-white px-1.5 py-1 rounded">
                              <span className="text-stone-400 font-bold">₡</span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={item.precio || ''}
                                onChange={(e) => handleUpdateProduct(item.id, 'precio', Math.max(0, parseFloat(e.target.value) || 0))}
                                placeholder="0"
                                className="w-full font-bold text-stone-900 bg-transparent outline-none text-right"
                              />
                            </div>
                          </td>

                          {/* Category Selector */}
                          <td className="py-2 px-3">
                            <select
                              value={item.categoria}
                              onChange={(e) => handleUpdateProduct(item.id, 'categoria', e.target.value)}
                              className="w-full bg-stone-50 border border-stone-200 text-stone-800 text-[11px] font-semibold rounded-lg px-2 py-1 outline-none focus:border-emerald-600"
                            >
                              {allAvailableCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </td>

                          {/* Delete row action */}
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(item.id)}
                              className="p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Eliminar este plato de la lista"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}

                      {filteredProducts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-stone-400 text-xs">
                            No hay platos en esta categoría. Puedes añadir uno nuevo abajo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Add new row footer bar */}
                <div className="p-2.5 bg-stone-50/70 border-t border-stone-200 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleAddNewProductRow()}
                    className="px-3 py-1.5 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Añadir plato manualmente</span>
                  </button>

                  <span className="text-[11px] text-stone-500">
                    💡 Puedes editar cualquier nombre, descripción o precio haciendo clic directamente sobre el texto.
                  </span>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-colors"
                >
                  Volver a cargar archivo
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0}
                    onClick={handleConfirmAndSaveToPOS}
                    className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                    <span>Confirmar y Guardar en POS ({selectedCount} platos)</span>
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
