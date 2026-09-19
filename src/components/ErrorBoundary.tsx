import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SaborAI POS - Uncaught runtime error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-900 text-stone-100 flex items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-white tracking-tight">
                Se detectó una discrepancia en la vista
              </h2>
              <p className="text-xs text-stone-400 leading-relaxed">
                El sistema protegió tus datos y turnos de caja para evitar pérdidas. Puedes restablecer la pantalla o recargar la aplicación sin perder información.
              </p>
              {this.state.error?.message && (
                <div className="p-2.5 rounded-xl bg-stone-900 border border-stone-800 text-[11px] font-mono text-rose-300 text-left overflow-x-auto max-h-24">
                  {this.state.error.message}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#a9b994] hover:bg-[#97a882] text-stone-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Restablecer Pantalla</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto px-5 py-2.5 bg-stone-800 hover:bg-stone-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all border border-stone-700 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recargar Aplicación</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
