import React, { useState, useRef, useEffect } from 'react';
import { BrandLogo } from './BrandLogos';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
  Sparkles, 
  X, 
  Send,
  AlertTriangle
} from 'lucide-react';

interface AICopilotChatProps {
  isOpen: boolean;
  onClose: () => void;
  onQuickAction?: (actionType: string) => void;
  currentUser?: import('../types').UserProfile;
}

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  isError?: boolean;
}

// La API Key de Gemini se lee de la variable de entorno VITE_GEMINI_API_KEY
// Agrégala en Vercel: Settings → Environment Variables → VITE_GEMINI_API_KEY
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

function getNysaClient(): GoogleGenerativeAI | null {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'tu_api_key_aqui' || GEMINI_API_KEY.trim() === '') {
    return null;
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

export const AICopilotChat: React.FC<AICopilotChatProps> = ({
  isOpen,
  onClose,
  onQuickAction,
  currentUser
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // messages debe declararse ANTES del useEffect que lo referencia
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg_1',
      sender: 'ai',
      text: '¡Hola! Soy Nysa, tu asistente personal de Saborai. Estoy aquí para guiarte y hacer que la gestión de tu restaurante sea un éxito. ¿En qué te puedo ayudar hoy?'
    }
  ]);

  // Auto-scroll al último mensaje cada vez que cambian los mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const apiReady = !!GEMINI_API_KEY && GEMINI_API_KEY !== 'tu_api_key_aqui' && GEMINI_API_KEY.trim() !== '';

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

    if (!apiReady) {
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          isError: true,
          text: '⚠️ La API Key de Gemini no está configurada. Para activarme, añade la variable VITE_GEMINI_API_KEY en los ajustes de Vercel (Settings → Environment Variables) y haz un Redeploy.'
        }
      ]);
      return;
    }

    try {
      const client = getNysaClient();
      if (!client) throw new Error('No se pudo inicializar el cliente de IA.');

      const roleName =
        currentUser?.role === 'ADMIN' ? 'Administrador' :
        currentUser?.role === 'CAJERO' ? 'Cajero' : 'Salonero';

      // Modelos serie 3.x (los 2.0 y 2.5 fueron descontinuados en junio 2026)
      const MODELS_TO_TRY = [
        'gemini-3.6-flash', // Estable en producción
        'gemini-3.7-flash', // Agosto 2026
        'gemini-3.8-flash', // El más nuevo y capaz
      ];

      const systemInstruction = `Eres Nysa, asistente de Saborai POS. Eres servicial, profesional y amigable.
Empleado: "${currentUser?.name || 'Empleado'}", Rol: ${roleName}.
Ayudas con el POS, menú, inventarios y ventas del restaurante.
Responde en español, de forma concisa. No menciones que eres de Google.`;

      const aiMsgId = `ai_${Date.now()}`;
      setMessages(prev => [...prev, { id: aiMsgId, sender: 'ai', text: '' }]);
      setIsTyping(false);

      let streamed = false;
      let lastError: unknown = null;

      for (const modelName of MODELS_TO_TRY) {
        try {
          const model = client.getGenerativeModel({ model: modelName, systemInstruction });
          const streamResult = await model.generateContentStream(userText);

          for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              streamed = true;
              setMessages(prev =>
                prev.map(m => m.id === aiMsgId ? { ...m, text: m.text + chunkText } : m)
              );
            }
          }
          break; // OK
        } catch (modelError: unknown) {
          lastError = modelError;
          const msg = modelError instanceof Error ? modelError.message : String(modelError);
          // Reintenta con el siguiente modelo ante cualquier error de servidor (4xx, 5xx)
          if (/\[4\d\d\s*\]|\[5\d\d\s*\]|overloaded|not found|no longer available|unavailable|quota/i.test(msg)) {
            console.warn(`Modelo ${modelName} falló (${msg.substring(0, 80)}), intentando siguiente...`);
            continue;
          }
          throw modelError; // Error de API key u otro crítico — no reintentamos
        }
      }

      if (!streamed && lastError) throw lastError;

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Nysa AI Error:', errMsg);
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          isError: true,
          text: `Lo siento, hubo un error al conectarme con mi cerebro de IA. Detalle: ${errMsg}`
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
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <span>Nysa AI</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${apiReady ? 'bg-[#a9b994] text-[#3b3733]' : 'bg-red-400 text-white'}`}>
                {apiReady ? 'Asistente Personal' : 'Sin Configurar'}
              </span>
            </h3>
            <p className="text-[11px] text-[#a9b994]">
              {apiReady ? 'Siempre a tu lado' : 'Configura VITE_GEMINI_API_KEY en Vercel'}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-gray-300 hover:text-white p-1 rounded-xl transition-colors"
        >
          <X className="w-5 h-5" />
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
                  ? 'bg-[#3b3733] text-[#fcfeff] rounded-br-none'
                  : msg.isError
                  ? 'bg-red-50 text-red-700 rounded-bl-none border border-red-200'
                  : 'bg-gray-100 text-[#3b3733] rounded-bl-none border border-gray-200'
              }`}
            >
              {msg.isError && <AlertTriangle className="w-3.5 h-3.5 inline mr-1 mb-0.5" />}
              {msg.text}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-[#6b686d] italic p-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-[#a9b994]" />
            <span>Nysa está pensando...</span>
          </div>
        )}
        {/* Ancla invisible al final del chat para el auto-scroll */}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="p-2 border-t border-[#6b686d]/15 bg-gray-50 flex items-center gap-1.5 overflow-x-auto text-[10px] scrollbar-none">
        <button
          onClick={() => handlePromptClick('¿Cómo agrego un producto al menú?')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          🍽️ Agregar producto
        </button>
        <button
          onClick={() => handlePromptClick('Recomendar maridaje para Ribeye')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          🍷 Sugerir Maridaje
        </button>
        <button
          onClick={() => handlePromptClick('¿Cómo cierro el turno correctamente?')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          🔄 Cerrar turno
        </button>
      </div>

      {/* Input bar */}
      <form onSubmit={handleSendMessage} className="p-3 bg-[#fcfeff] border-t border-[#6b686d]/20 flex items-center gap-2">
        <input
          type="text"
          placeholder={apiReady ? "Pregúntale a Nysa lo que necesites..." : "Configura la API Key para activar Nysa..."}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#6b686d]/30 text-xs text-[#3b3733] focus:border-[#a9b994] focus:outline-none"
        />
        <button
          type="submit"
          disabled={!inputMessage.trim()}
          className="p-2.5 bg-[#3b3733] text-[#fcfeff] disabled:opacity-40 rounded-xl hover:bg-[#25221f] transition-colors"
        >
          <Send className="w-4 h-4 text-[#a9b994]" />
        </button>
      </form>

    </div>
  );
};
