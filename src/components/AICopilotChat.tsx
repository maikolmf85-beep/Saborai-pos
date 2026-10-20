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
import { MenuItem, Table, UserProfile } from '../types';
import { nyzaLearningService } from '../services/nyzaLearningService';

interface AICopilotChatProps {
  isOpen: boolean;
  onClose: () => void;
  onQuickAction?: (actionType: string) => void;
  currentUser?: UserProfile;
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

export const AICopilotChat: React.FC<AICopilotChatProps> = ({
  isOpen,
  onClose,
  onQuickAction,
  currentUser,
  menuItems = [],
  selectedTable = null,
  zones = [],
  onOpenLearningHub
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      text: '¡Pura vida! Soy **Nyza**, tu especialista de autodiagnóstico y soporte inteligente en **Saborai POS**. ¿Qué puedo revisar o resolver por vos hoy?'
    }
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const envGeminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
  const localGeminiKey = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('saborai_gemini_api_key') || localStorage.getItem('saborai_ai_api_key') || '').trim()
    : '';
  const customApiKey = localGeminiKey || envGeminiKey;

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userText = inputMessage.trim();

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: userText
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsTyping(true);

    try {
      const learningContext = /aprend|mejor|iq|evoluciona|conocimiento/i.test(userText)
        ? nyzaLearningService.getSystemPromptKnowledgeContext()
        : undefined;
      const compactMenu = menuItems.map(m => ({
        name: m.name,
        price: m.price,
        category: m.category,
        available: m.available,
        modifiers: m.modifiers?.map(mod => ({ name: mod.name, choices: mod.choices.map(c => c.name) }))
      }));

      const aiMsgId = `ai_${Date.now()}`;
      setMessages(prev => [...prev, { id: aiMsgId, sender: 'ai', text: '' }]);
      setIsTyping(true);

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
          customApiKey: customApiKey || undefined,
          context: {
            menuItems: compactMenu,
            selectedTable,
            currentUser,
            zones,
            knowledgeContext: learningContext
          }
        })
      });

      setIsTyping(false);

      if (!apiRes.ok) {
        const errJson = await apiRes.json().catch(() => ({}));
        const errorParts = [errJson.error, errJson.details].filter(Boolean);
        throw new Error(Array.from(new Set(errorParts)).join(' ') || 'No se pudo comunicar con el servicio de IA.');
      }

      const data = await apiRes.json();
      const displayContent = data.response || 'Sin respuesta';
      const rawText = data.rawResponse || displayContent;

      setMessages(prev =>
        prev.map(m => m.id === aiMsgId ? { ...m, text: displayContent } : m)
      );

      // Ejecutar comandos detectados en el bloque JSON o devueltos por el backend
      if (onQuickAction) {
        if (data.action) {
          if (Array.isArray(data.action.actions)) {
            data.action.actions.forEach((action: unknown) => onQuickAction(JSON.stringify(action)));
          } else {
            onQuickAction(JSON.stringify(data.action));
          }
        } else if (rawText) {
          const match = rawText.match(/```json\n(\{.*?\})\n```/s);
          if (match && match[1]) {
            onQuickAction(match[1]);
          }
        }
      }

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Nyza AI Error:', errMsg);
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          isError: true,
          text: `Lo siento, hubo un inconveniente al conectarme: ${errMsg}`
        }
      ]);
    }
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
          <BrandLogo variant="isotype" size="sm" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm">Nyza</h3>
              {onOpenLearningHub ? (
                <button
                  type="button"
                  onClick={onOpenLearningHub}
                  title="Abrir Centro de Aprendizaje e Inteligencia Global de Nyza"
                  className="flex items-center gap-1 text-[10px] bg-[#a9b994] text-[#3b3733] px-2 py-0.5 rounded-full font-black hover:bg-white hover:scale-105 transition-all cursor-pointer shadow-xs"
                >
                  <BrainCircuit className="w-3 h-3 text-[#3b3733]" />
                  <span>IQ {nyzaLearningService.getCurrentIQ()}</span>
                </button>
              ) : (
                <span className="text-[10px] bg-[#a9b994] text-[#3b3733] px-1.5 py-0.2 rounded-full font-black">
                  IQ {nyzaLearningService.getCurrentIQ()}
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-300">Autodiagnóstico & Aprendizaje Continuo SaborAI POS</p>
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

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-[#6b686d] italic p-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-[#a9b994]" />
            <span>Nyza está pensando y diagnosticando...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="p-2 border-t border-[#6b686d]/15 bg-gray-50 flex items-center gap-1.5 overflow-x-auto text-[10px] scrollbar-none">
        <button
          onClick={() => handlePromptClick('¿Qué has aprendido hoy del sistema y qué mejoras aplicaste?')}
          className="px-2.5 py-1 rounded-full bg-white border border-[#a9b994] text-[#3b3733] hover:bg-[#a9b994]/20 whitespace-nowrap font-bold cursor-pointer flex items-center gap-1"
        >
          <BrainCircuit className="w-3 h-3 text-[#a9b994]" />
          <span>🧠 ¿Qué aprendiste hoy?</span>
        </button>
        <button
          onClick={() => handlePromptClick('¿Qué platillos tienen stock crítico o insumos bajos?')}
          className="px-2.5 py-1 rounded-full bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 whitespace-nowrap font-bold cursor-pointer flex items-center gap-1"
        >
          <span>📉 Alertas de Stock</span>
        </button>
        <button
          onClick={() => handlePromptClick('Ejecuta un ciclo de aprendizaje diario y dime tu IQ')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          ⚡ Ciclo de aprendizaje
        </button>
        <button
          onClick={() => handlePromptClick('La comanda de la cocina no imprime')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          🖨️ Falla impresora cocina
        </button>
        <button
          onClick={() => handlePromptClick('El sistema se siente pegado o lento')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          ⚡ Liberar memoria
        </button>
        <button
          onClick={() => handlePromptClick('Marca error al enviar factura a Hacienda')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium cursor-pointer"
        >
          🇨🇷 Estado Hacienda DGT
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
