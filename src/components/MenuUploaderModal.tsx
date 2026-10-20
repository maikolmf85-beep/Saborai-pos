import React, { useState, useRef, useEffect } from 'react';
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
  Edit3,
  Key,
  RotateCw
} from 'lucide-react';
import { MenuItem, TaxRegime } from '../types';
import { soundService } from '../services/soundEffects';
import { resolveRestaurantCabys, isValidCabys } from '../services/cabysService';

export interface ExtractedProduct {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  categoria: string;
  selected: boolean;
  tipo_producto?: string;
  cabys?: string;
}

export interface ExtractedCategory {
  nombre_categoria: string;
  productos: Array<{
    nombre: string;
    descripcion?: string;
    precio: number;
    tipo_producto?: string;
    cabys?: string;
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
  const [extractedProvider, setExtractedProvider] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('Todas');
  const [newCatInput, setNewCatInput] = useState<string>('');
  const [showAddCatInput, setShowAddCatInput] = useState(false);

  // IA API Key manual override (persisted in localStorage)
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? (localStorage.getItem('saborai_gemini_api_key') || localStorage.getItem('saborai_ai_api_key')) : '') || '';
  });
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isGoogleDenied, setIsGoogleDenied] = useState(false);
  const [isHighDemand, setIsHighDemand] = useState(false);

  // Sincronizar clave guardada cada vez que se abre el modal
  useEffect(() => {
    if (isOpen && typeof localStorage !== 'undefined') {
      const saved = (localStorage.getItem('saborai_gemini_api_key') || localStorage.getItem('saborai_ai_api_key') || '').trim();
      if (saved) {
        setCustomApiKey(saved);
      }
    }
  }, [isOpen]);

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
    setIsGoogleDenied(false);
    setIsHighDemand(false);
    setExtractedProducts([]);
  };

  /** Redimensiona fotos grandes para evitar superar el límite de payload (4.5MB) de Vercel */
  const prepareFileDataUri = async (file: File): Promise<{ dataUri: string; mimeType: string }> => {
    if (file.type.startsWith('image/')) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1920;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            const reader = new FileReader();
            reader.onload = () => resolve({ dataUri: reader.result as string, mimeType: file.type || 'image/jpeg' });
            reader.readAsDataURL(file);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ dataUri: compressed, mimeType: 'image/jpeg' });
        };
        img.onerror = () => {
          const reader = new FileReader();
          reader.onload = () => resolve({ dataUri: reader.result as string, mimeType: file.type || 'image/jpeg' });
          reader.readAsDataURL(file);
        };
        img.src = URL.createObjectURL(file);
      });
    } else {
      // Documentos PDF
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUri: reader.result as string, mimeType: file.type || 'application/pdf' });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
  };

  const handleProcessFileWithAI = async () => {
    if (!selectedFile) return;

    setErrorMsg(null);
    setStep('processing');
    soundService.playKeyClickSound();

    try {
      // 1. Optimizar y convertir archivo a Base64
      const { dataUri: fileDataUri, mimeType: resolvedMime } = await prepareFileDataUri(selectedFile);

      // 2. Invocar endpoint seguro /api/parse-menu
      const effectiveKey = (
        customApiKey.trim() ||
        (typeof localStorage !== 'undefined' ? (localStorage.getItem('saborai_gemini_api_key') || localStorage.getItem('saborai_ai_api_key') || '').trim() : '')
      );
      const envGeminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
      const finalGeminiKey = effectiveKey || envGeminiKey;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (finalGeminiKey) {
        headers['x-gemini-api-key'] = finalGeminiKey;
      }

      const res = await fetch('/api/parse-menu', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileBase64: fileDataUri,
          mimeType: resolvedMime,
          customKey: effectiveKey || undefined,
          geminiApiKey: finalGeminiKey
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const fullMessage = errJson.details || errJson.error || `Error del servidor (${res.status})`;
        
        // Si el error es de alta demanda en Gemini
        if (
          errJson.isHighDemand ||
          fullMessage.toLowerCase().includes('high demand') ||
          fullMessage.toLowerCase().includes('alta demanda') ||
          fullMessage.toLowerCase().includes('spikes in demand') ||
          fullMessage.toLowerCase().includes('temporarily')
        ) {
          setIsHighDemand(true);
        } else if (
          errJson.isGoogleDenied ||
          fullMessage.toLowerCase().includes('denied access') ||
          fullMessage.toLowerCase().includes('permission_denied')
        ) {
          setIsGoogleDenied(true);
          setShowApiKeyInput(true);
        } else if (fullMessage.toLowerCase().includes('api_key') || fullMessage.toLowerCase().includes('api key')) {
          setShowApiKeyInput(true);
        }

        throw new Error(fullMessage);
      }

      const payload = await res.json();
      const menuData = payload.data || payload;
      setExtractedProvider(payload.provider || 'Gemini 3.8 Flash');
      const categorias: ExtractedCategory[] = menuData.categorias || [];

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
              selected: true,
              tipo_producto: prod.tipo_producto || undefined,
              cabys: prod.cabys ? String(prod.cabys).trim() : undefined
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

    // Determine station based on category name and tipo_producto
    const guessStation = (cat: string, name: string, tipo?: string): 'Cocina' | 'Bar' | 'Postres' => {
      if (tipo === 'bebida_alcoholica' || tipo === 'bebida_no_alcoholica') {
        return 'Bar';
      }
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
    const newMenuItems: MenuItem[] = approvedProducts.map((p, index) => {
      const station = guessStation(p.categoria, p.nombre, p.tipo_producto);
      const validCabys = isValidCabys(p.cabys) 
        ? p.cabys! 
        : resolveRestaurantCabys(p.nombre, p.categoria, undefined, station).codigo;
      return {
        id: `item_ai_${Date.now()}_${index}`,
        name: p.nombre.trim(),
        description: p.descripcion.trim(),
        price: Math.max(0, p.precio),
        category: p.categoria.trim(),
        station,
        cabysCode: validCabys,
        taxRate: taxRegime === 'SIMPLIFIED' ? 0 : 0.13,
        available: true,
        imageIcon: station === 'Bar' ? '🍹' : station === 'Postres' ? '🍰' : '🍽️',
        ingredients: []
      };
    });

    // Detect new categories
    const newlyAddedCategories = distinctCategories.filter(c => !existingCategories.includes(c));

    soundService.playSuccessChime();
    onImportSuccess(newMenuItems, newlyAddedCategories);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-stone-950/70 backdrop-blur-md animate-in fade-in duration-200">
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
                  Claude & Gemini IA
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
            <div className="mb-4 space-y-3 animate-in fade-in">
              <div className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs ${
                isGoogleDenied || isHighDemand
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${isGoogleDenied || isHighDemand ? 'text-amber-600' : 'text-red-600'}`} />
                <div className="flex-1 space-y-2">
                  <div>
                    <span className="font-bold block">
                      {isHighDemand 
                        ? 'Alta demanda en Google Gemini:' 
                        : isGoogleDenied 
                        ? 'Acceso denegado en Google Cloud (Proyecto Gemini bloqueado):' 
                        : 'No pudimos procesar el archivo:'}
                    </span>
                    <span className="leading-relaxed">{errorMsg}</span>
                  </div>

                  {isHighDemand && (
                    <div className="pt-2 flex items-center justify-between gap-3 border-t border-amber-200">
                      <p className="text-[11px] text-amber-800">
                        Los picos de demanda en Google suelen durar solo unos segundos.
                      </p>
                      <button
                        type="button"
                        onClick={handleProcessFileWithAI}
                        className="px-3.5 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Reintentar ahora</span>
                      </button>
                    </div>
                  )}

                  {/* Inline key configuration right inside the banner */}
                  {(isHighDemand || isGoogleDenied) && (
                    <div className="pt-2.5 border-t border-amber-200/90 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-amber-950 font-bold">
                        <span>🔑 Guarda tu clave activa para este navegador:</span>
                        <span className="text-[10px] text-amber-700 font-normal">(No volverá a fallar)</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={customApiKey}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setCustomApiKey(val);
                            if (typeof localStorage !== 'undefined') {
                              if (val) {
                                localStorage.setItem('saborai_gemini_api_key', val);
                                localStorage.setItem('saborai_ai_api_key', val);
                              } else {
                                localStorage.removeItem('saborai_gemini_api_key');
                                localStorage.removeItem('saborai_ai_api_key');
                              }
                            }
                          }}
                          placeholder="Pega aquí tu clave de Gemini (AIzaSy...)"
                          className="flex-1 px-3 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-mono text-stone-900 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                        />
                        <button
                          type="button"
                          disabled={!customApiKey.trim()}
                          onClick={() => {
                            if (customApiKey.trim()) {
                              if (typeof localStorage !== 'undefined') {
                                localStorage.setItem('saborai_gemini_api_key', customApiKey.trim());
                                localStorage.setItem('saborai_ai_api_key', customApiKey.trim());
                              }
                              setErrorMsg(null);
                              handleProcessFileWithAI();
                            }
                          }}
                          className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
                        >
                          Guardar y Analizar
                        </button>
                      </div>
                    </div>
                  )}

                  {isGoogleDenied && (
                    <div className="p-3 bg-white/90 rounded-xl border border-amber-200 text-[11px] text-stone-700 space-y-1.5 shadow-2xs">
                      <p className="font-bold text-amber-900">
                        ⚡ Solución recomendada en 1 minuto:
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-stone-600">
                        <li>
                          Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-emerald-700 font-bold underline">Google AI Studio (Crear clave)</a>.
                        </li>
                        <li>
                          Haz clic en el botón <strong>"Create API Key"</strong> y selecciona <strong>"Create in new project"</strong> (en un proyecto NUEVO, no en el que está bloqueado).
                        </li>
                        <li>
                          Pega tu nueva clave en el campo <strong>"Motor de IA"</strong> abajo o directamente en las variables de entorno de Vercel.
                        </li>
                      </ol>
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setErrorMsg(null)}
                  className="text-stone-400 hover:text-stone-700 font-bold p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
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

              {/* Multi-Engine API Key Box (Manual override or Server ENV) */}
              <div className="p-3 bg-stone-50 border border-stone-200/90 rounded-2xl text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-stone-800 font-bold">
                    <Key className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Motor de IA (Claude / Gemini)</span>
                    {customApiKey ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        {customApiKey.startsWith('sk-ant-') ? 'Claude Key activa ✓' : 'Gemini Key activa ✓'}
                      </span>
                    ) : (
                      <span className="text-[10px] text-stone-500 font-normal">
                        (Usa el motor IA configurado en el servidor por defecto)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer"
                  >
                    {showApiKeyInput ? 'Ocultar' : customApiKey ? 'Editar clave' : 'Configurar clave'}
                  </button>
                </div>

                {showApiKeyInput && (
                  <div className="pt-2 border-t border-stone-200 space-y-2 animate-in fade-in">
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={customApiKey}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setCustomApiKey(val);
                          if (val) {
                            localStorage.setItem('saborai_gemini_api_key', val);
                          } else {
                            localStorage.removeItem('saborai_gemini_api_key');
                          }
                        }}
                        placeholder="sk-ant-... (Claude) o AIzaSy... (Gemini)"
                        className="flex-1 px-3 py-1.5 bg-white border border-stone-300 rounded-xl text-xs font-mono text-stone-900 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                      />
                      {customApiKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomApiKey('');
                            localStorage.removeItem('saborai_gemini_api_key');
                          }}
                          className="px-3 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {customApiKey && (
                      <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Clave guardada para futuros usos en este navegador.</span>
                      </p>
                    )}
                    <p className="text-[11px] text-stone-500">
                      💡 <strong>¿Por qué funciona al pegarla aquí?</strong> Porque esta clave nueva que creaste tiene cuota fresca y sin congestión. Para que funcione en todos tus dispositivos sin tener que escribirla nunca más, actualiza la variable <code className="bg-stone-200 px-1 rounded text-stone-800 font-mono">GEMINI_API_KEY</code> en tu panel de <strong>Vercel</strong> (Project Settings → Environment Variables) con esta misma clave.
                    </p>
                  </div>
                )}
              </div>

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
                  La IA multimodal está procesando el archivo, agrupando categorías, recetas y precios estructurados.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 rounded-full text-[11px] font-semibold border border-emerald-200">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Extrayendo estructura del menú con visión artificial...</span>
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
                  {extractedProvider && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {extractedProvider}
                    </span>
                  )}
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
