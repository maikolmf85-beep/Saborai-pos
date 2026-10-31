import React, { useState, useRef, useEffect } from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  Sparkles, 
  X, 
  Send, 
  AlertTriangle, 
  Mic, 
  MicOff,
  BrainCircuit
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { MenuItem, Table } from '../types';
import { nyzaLearningService } from '../services/nyzaLearningService';
import { describeNyzaAction, getNyzaMenuSnapshot, getNyzaTableSnapshot } from '../services/nyzaActionValidation';

interface AICopilotChatProps {
  isOpen: boolean;
  onClose: () => void;
  onQuickAction?: (actionType: string) => void;
  tenantId: string;
  menuItems?: MenuItem[];
  selectedTable?: Table | null;
  zones?: string[];
  onOpenLearningHub?: () => void;
}

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  isError?: boolean;
}

interface PendingAction {
  id: string;
  action: unknown;
  preview: string;
  expectedSelectedTableId?: string;
  expectedSelectedTableSnapshot?: string;
  expectedMenuSnapshot?: string;
  expectedTenantId: string;
}

export const AICopilotChat: React.FC<AICopilotChatProps> = ({
  isOpen,
  onClose,
  onQuickAction,
  tenantId,
  menuItems = [],
  selectedTable = null,
  zones = [],
  onOpenLearningHub
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handledActionIdsRef = useRef(new Set<string>());
  const currentTenantIdRef = useRef(tenantId);

  // Funcionalidad de voz
  const startListening = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Tu navegador no soporta entrada por voz. Te sugerimos usar Google Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CR';
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setInputMessage(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg_1',
      sender: 'ai',
      text: '¡Pura vida! Soy **Nyza**, el asistente de SaborAI POS. Puedo orientarte, consultar existencias locales o proponer acciones para que las revises y confirmes.'
    }
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    currentTenantIdRef.current = tenantId;
    nyzaLearningService.setTenantId(tenantId);
  }, [tenantId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userText = inputMessage.trim();
    const requestTenantId = tenantId;

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: userText
    };

    const aiMsgId = `ai_${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: aiMsgId, sender: 'ai', text: '' }]);
    setInputMessage('');
    setIsTyping(true);

    try {
      const normalizedText = userText.toLocaleLowerCase('es-CR');
      const needsStockContext = /stock|inventar|insumo|existencia|agotad|bajo|cr[ií]tic/.test(normalizedText);
      const needsMenuContext = needsStockContext || /men[uú]|precio|carta|categor[ií]a|bebida|postre|platillo|producto|comanda|pedido|hamburgues|rib eye|carne/.test(normalizedText);
      const needsOrderContext = /mesa|comanda|pedido|agregar|pon|quitar|sin cebolla|pepinillo|t[eé]rmino/.test(normalizedText);
      const needsZoneContext = /sal[oó]n|mesa|terraza|patio|barra|zona|[aá]rea/.test(normalizedText);
      nyzaLearningService.setTenantId(tenantId);
      const learningContext = /aprend|mejor|iq|evoluciona|conocimiento|regla|nota local/i.test(userText)
        ? nyzaLearningService.getLocalLearningSummary()
        : undefined;
      const compactMenu = needsMenuContext ? menuItems.slice(0, 500).map(m => ({
        name: m.name,
        price: m.price,
        category: m.category,
        available: m.available,
        modifiers: m.modifiers?.map(mod => ({
          name: mod.name,
          choices: mod.choices.map(choice => ({ name: choice.name, extraPrice: choice.extraPrice }))
        })),
        ingredients: needsStockContext ? m.ingredients?.map(ingredient => ({
          name: ingredient.name,
          currentStock: ingredient.currentStock,
          requiredQty: ingredient.requiredQty,
          unit: ingredient.unit
        })) : undefined
      })) : [];

      const token = localStorage.getItem('saborai_token');
      const apiRes = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          userText,
          messages: messages.slice(-6),
          context: {
            menuItems: compactMenu,
            menuItemCount: needsMenuContext ? menuItems.length : 0,
            selectedTable: needsOrderContext && selectedTable
              ? { id: selectedTable.id, name: selectedTable.name, status: selectedTable.status, seats: selectedTable.seats }
              : null,
            zones: needsZoneContext ? zones : [],
            localLearningSummary: learningContext
          }
        })
      });

      if (currentTenantIdRef.current !== requestTenantId) return;
      setIsTyping(false);

      if (!apiRes.ok) {
        const errJson = await apiRes.json().catch(() => ({}));
        const errorParts = [errJson.error, errJson.details].filter(Boolean);
        throw new Error(Array.from(new Set(errorParts)).join(' ') || 'No se pudo comunicar con el servicio de IA.');
      }

      const data = await apiRes.json();
      if (currentTenantIdRef.current !== requestTenantId) return;
      const hasActions = Boolean(data.action && typeof data.action === 'object');
      const displayContent = hasActions
        ? 'Nyza propone una acción. Revisa el detalle y confirma si quieres aplicarla; todavía no se ha ejecutado.'
        : data.response || 'Sin respuesta';

      setMessages(prev =>
        prev.map(m => m.id === aiMsgId ? { ...m, text: displayContent } : m)
      );

      if (hasActions) {
        const proposed = Array.isArray(data.action.actions) ? data.action.actions : [data.action];
        const cards = proposed.slice(0, 5).map((action: unknown, index: number) => {
          const actionRecord = action && typeof action === 'object' ? action as Record<string, unknown> : {};
          const actionType = String(actionRecord.type || actionRecord.action || '').toUpperCase();
          const params = actionRecord.params && typeof actionRecord.params === 'object'
            ? actionRecord.params as Record<string, unknown>
            : actionRecord;
          const productName = typeof params.product === 'string' ? params.product.trim().toLocaleLowerCase() : '';
          const matchedItems = productName
            ? menuItems.filter(item => item.name.trim().toLocaleLowerCase() === productName)
            : [];
          const matchedItem = matchedItems.length === 1 ? matchedItems[0] : null;
          return {
            id: `${aiMsgId}_action_${index}`,
            action,
            preview: describeNyzaAction(action, { menuItems, selectedTable }),
            expectedSelectedTableId: actionType === 'ADD_ITEM' ? selectedTable?.id : undefined,
            expectedSelectedTableSnapshot: actionType === 'ADD_ITEM' && selectedTable ? getNyzaTableSnapshot(selectedTable) : undefined,
            expectedMenuSnapshot: ['ADD_ITEM', 'TOGGLE_DISH_AVAILABILITY'].includes(actionType) && matchedItem
              ? getNyzaMenuSnapshot(matchedItem)
              : undefined,
            expectedTenantId: requestTenantId
          };
        });
        setPendingActions(prev => [...prev, ...cards].slice(-5));
      }

    } catch (error: unknown) {
      if (currentTenantIdRef.current !== requestTenantId) return;
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Nyza AI Error:', errMsg);
      setIsTyping(false);
      setMessages(prev => [
        ...prev.map(message => message.id === aiMsgId
          ? { ...message, isError: true, text: `Lo siento, hubo un inconveniente al conectarme: ${errMsg}` }
          : message)
      ]);
    }
  };

  const confirmAction = (pending: PendingAction) => {
    if (!onQuickAction || handledActionIdsRef.current.has(pending.id)) return;
    handledActionIdsRef.current.add(pending.id);
    if (handledActionIdsRef.current.size > 100) {
      const oldest = handledActionIdsRef.current.values().next().value;
      if (oldest) handledActionIdsRef.current.delete(oldest);
    }
    const action = pending.action && typeof pending.action === 'object'
      ? {
          ...(pending.action as Record<string, unknown>),
          ...(pending.expectedSelectedTableId ? { __nyzaExpectedTableId: pending.expectedSelectedTableId } : {}),
          ...(pending.expectedSelectedTableSnapshot ? { __nyzaExpectedTableSnapshot: pending.expectedSelectedTableSnapshot } : {}),
          ...(pending.expectedMenuSnapshot ? { __nyzaExpectedMenuSnapshot: pending.expectedMenuSnapshot } : {}),
          __nyzaExpectedTenantId: pending.expectedTenantId
        }
      : pending.action;
    onQuickAction(JSON.stringify(action));
    setPendingActions(prev => prev.filter(action => action.id !== pending.id));
  };

  const discardAction = (pendingId: string) => {
    setPendingActions(prev => prev.filter(action => action.id !== pendingId));
  };

  const handlePromptClick = (promptText: string) => {
    setInputMessage(promptText);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-md bg-[#fcfeff] border-2 border-[#3b3733]/20 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[580px] animate-in slide-in-from-bottom-5">
      
      {/* Copilot Header */}
      <div className="bg-[#3b3733] text-[#fcfeff] p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#f4f7f0] shrink-0">
            <BrandLogo variant="isotype" size="sm" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm">Nyza</h3>
              {onOpenLearningHub ? (
                <button
                  type="button"
                  onClick={onOpenLearningHub}
                  title="Abrir notas locales y capacidades de Nyza"
                  className="flex items-center gap-1 text-[10px] bg-[#a9b994] text-[#3b3733] px-2 py-0.5 rounded-full font-black hover:bg-white hover:scale-105 transition-all cursor-pointer shadow-xs"
                >
                  <BrainCircuit className="w-3 h-3 text-[#3b3733]" />
                  <span>Notas locales</span>
                </button>
              ) : (
                <span className="text-[10px] bg-[#a9b994] text-[#3b3733] px-1.5 py-0.2 rounded-full font-black">
                  Notas locales
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-300">Asistente POS · acciones con aprobación</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages Container */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-[#fcfeff]">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                msg.sender === 'user'
                  ? 'bg-[#3b3733] text-white font-medium rounded-br-none shadow-sm'
                  : msg.isError
                  ? 'bg-red-50 text-red-700 rounded-bl-none border border-red-200'
                  : 'bg-[#f4f7f0] text-stone-900 font-medium rounded-bl-none border border-[#a9b994]/40 shadow-sm'
              }`}
            >
              {msg.isError && <AlertTriangle className="w-3.5 h-3.5 inline mr-1 mb-0.5" />}
              <div className="prose prose-sm max-w-none prose-p:leading-snug prose-li:my-0.5 prose-p:my-1 text-inherit [&_p]:text-inherit [&_a]:text-inherit [&_strong]:text-inherit [&_ul]:text-inherit [&_ol]:text-inherit [&_li]:text-inherit [&_h1]:text-inherit [&_h2]:text-inherit [&_h3]:text-inherit">
                <ReactMarkdown>
                  {msg.text}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {pendingActions.map((pending) => (
          <div key={pending.id} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" role="group" aria-label="Acción propuesta por Nyza pendiente de confirmación">
            <p className="font-bold">Revisión antes de ejecutar</p>
            <p className="mt-1">{pending.preview}</p>
            <p className="mt-1 text-[11px]">Nada cambia en el POS hasta que confirmes.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => confirmAction(pending)} disabled={!onQuickAction} className="rounded-lg bg-[#3b3733] px-3 py-1.5 font-bold text-white disabled:opacity-40">
                Confirmar acción
              </button>
              <button type="button" onClick={() => discardAction(pending.id)} className="rounded-lg border border-amber-700/30 px-3 py-1.5 font-bold text-amber-950">
                Cancelar
              </button>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-[#6b686d] italic p-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-[#a9b994]" />
            <span>Nyza está preparando una respuesta...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="p-2 border-t border-[#6b686d]/15 bg-gray-50 flex items-center gap-1.5 overflow-x-auto text-[10px] scrollbar-none">
        <button
          onClick={() => handlePromptClick('¿Qué reglas locales guarda Nyza y qué hace realmente?')}
          className="px-2.5 py-1 rounded-full bg-white border border-[#a9b994] text-[#3b3733] hover:bg-[#a9b994]/20 whitespace-nowrap font-bold cursor-pointer flex items-center gap-1"
        >
          <BrainCircuit className="w-3 h-3 text-[#a9b994]" />
          <span>🧠 Reglas locales</span>
        </button>
        <button
          onClick={() => handlePromptClick('¿Qué platillos tienen stock crítico o insumos bajos?')}
          className="px-2.5 py-1 rounded-full bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 whitespace-nowrap font-bold cursor-pointer flex items-center gap-1"
        >
          <span>📉 Alertas de Stock</span>
        </button>
        <button
          onClick={() => handlePromptClick('¿Qué reglas locales guarda Nyza y qué hace realmente?')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          ⚡ Ver capacidades reales
        </button>
        <button
          onClick={() => handlePromptClick('La comanda de la cocina no imprime')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          🖨️ Falla impresora cocina
        </button>
        <button
          onClick={() => handlePromptClick('¿Nyza puede liberar memoria RAM o reparar el sistema automáticamente?')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          ⚡ Límites de reparación
        </button>
        <button
          onClick={() => handlePromptClick('¿Qué puedo revisar si marca error al enviar factura a Hacienda?')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          🇨🇷 Guía de facturación DGT
        </button>
      </div>

      {/* Input bar */}
      <form onSubmit={handleSendMessage} className="p-3 bg-[#fcfeff] border-t border-[#6b686d]/20 flex items-center gap-2">
        <button
          type="button"
          onClick={isListening ? () => {} : startListening}
          className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
            isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title="Hablar con Nyza"
        >
          {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
        <input
          type="text"
          placeholder="Escribe a Nyza tu consulta o reporte..."
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#6b686d]/30 text-xs text-[#3b3733] focus:border-[#a9b994] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!inputMessage.trim()}
          className="p-2.5 bg-[#3b3733] text-[#fcfeff] disabled:opacity-40 rounded-xl hover:bg-[#25221f] transition-colors cursor-pointer"
        >
          <Send className="w-4 h-4 text-[#a9b994]" />
        </button>
      </form>

    </div>
  );
};

export default AICopilotChat;
