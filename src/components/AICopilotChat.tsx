import React, { useState } from 'react';
import { BrandLogo } from './BrandLogos';
import { 
  Sparkles, 
  X, 
  Send, 
  Bot, 
  User, 
  Utensils, 
  FileCheck2, 
  TrendingUp, 
  CheckCircle2,
  HelpCircle,
  Lightbulb
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
  actionCard?: {
    type: 'cabys' | 'recipe' | 'sales' | 'general';
    title: string;
    details: string;
  };
}

export const AICopilotChat: React.FC<AICopilotChatProps> = ({
  isOpen,
  onClose,
  onQuickAction,
  currentUser
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg_1',
      sender: 'ai',
      text: '¡Hola! Soy Nysa, tu asistente personal de Saborai. Estoy aquí para guiarte y hacer que la gestión de tu restaurante sea un éxito. ¿En qué te puedo ayudar hoy?'
    }
  ]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      text: inputMessage
    };

    setMessages(prev => [...prev, userMsg]);
    const query = inputMessage.toLowerCase();
    setInputMessage('');
    setIsTyping(true);

    try {
      const roleName = currentUser?.role === 'ADMIN' ? 'Administrador' : currentUser?.role === 'CAJERO' ? 'Cajero' : 'Salonero';
      const contextStr = `El usuario interactuando contigo se llama ${currentUser?.name || 'Empleado'} y su rol es: ${roleName}.`;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, context: contextStr })
      });

      if (!res.ok) {
        throw new Error('Error en la respuesta del servidor');
      }

      const data = await res.json();

      setMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          text: data.text || 'Hubo un error al procesar mi respuesta. Por favor intenta de nuevo.',
        }
      ]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          text: 'Lo siento mucho, actualmente no puedo conectarme con mi cerebro de IA. Verifica tu conexión a internet o asegúrate de que la API Key esté configurada en Vercel.',
        }
      ]);
    } finally {
      setIsTyping(false);
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
          {/* Official Variant for Copilot Floating: Isotipo Bicromático */}
          <BrandLogo variant="isotype" size="sm" />
          <div>
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <span>Nysa AI</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#a9b994] text-[#3b3733] font-black uppercase">
                Asistente Personal
              </span>
            </h3>
            <p className="text-[11px] text-[#a9b994]">Siempre a tu lado</p>
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
                  : 'bg-gray-100 text-[#3b3733] rounded-bl-none border border-gray-200'
              }`}
            >
              {msg.text}
            </div>

            {/* Action card if returned */}
            {msg.actionCard && (
              <div className="mt-2 max-w-[85%] p-3 rounded-2xl bg-[#a9b994]/20 border border-[#a9b994]/50 text-xs text-[#3b3733] space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#3b3733]" />
                  <span>{msg.actionCard.title}</span>
                </div>
                <p className="text-[11px] text-[#6b686d]">{msg.actionCard.details}</p>
              </div>
            )}
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-[#6b686d] italic p-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-[#a9b994]" />
            <span>Nysa está pensando...</span>
          </div>
        )}
      </div>

      {/* Suggested Quick Prompts */}
      <div className="p-2 border-t border-[#6b686d]/15 bg-gray-50 flex items-center gap-1.5 overflow-x-auto text-[10px] scrollbar-none">
        <button
          onClick={() => handlePromptClick('Validar códigos CABYS de Hacienda')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          🔍 Validar CABYS
        </button>
        <button
          onClick={() => handlePromptClick('Recomendar maridaje para Ribeye')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          🍷 Sugerir Maridaje
        </button>
        <button
          onClick={() => handlePromptClick('Proyectar quiebre de stock')}
          className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-[#3b3733] hover:border-[#a9b994] whitespace-nowrap font-medium"
        >
          📦 Alerta Stock
        </button>
      </div>

      {/* Input bar */}
      <form onSubmit={handleSendMessage} className="p-3 bg-[#fcfeff] border-t border-[#6b686d]/20 flex items-center gap-2">
        <input
          type="text"
          placeholder="Pregúntale a Nysa lo que necesites..."
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
