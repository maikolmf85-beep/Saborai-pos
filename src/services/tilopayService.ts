export interface TilopayPaymentRequest {
  reference: string;
}

export interface TilopaySignupHandoffRequest {
  email: string;
  password: string;
  restaurantName: string;
  phone: string;
}

export interface TilopaySubscriptionResponse {
  success: boolean;
  transactionId?: string;
  message?: string;
  error?: string;
  pending?: boolean;
}

class TilopayService {
  /** Stores signup state and the canonical purchase intent server-side. */
  public async createSignupHandoff(payload: TilopaySignupHandoffRequest): Promise<string> {
    const response = await fetch('/api/tilopay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create-signup-handoff', payload })
    });
    const data = await response.json();

    if (!response.ok || typeof data.reference !== 'string') {
      throw new Error(data.error || 'No se pudo iniciar el registro seguro.');
    }
    return data.reference;
  }

  /** Generates a provider URL from the server-bound intent only. */
  public async getPaymentUrl(request: TilopayPaymentRequest): Promise<string> {
    const response = await fetch('/api/tilopay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tokenize', payload: request })
    });
    const data = await response.json();

    if (!response.ok || typeof data.url !== 'string') {
      throw new Error(data.error || 'Error al conectar con la pasarela de pagos.');
    }
    return data.url;
  }

  /** Completes registration; the server reads identity and plan from the handoff. */
  public async completeSignup(reference: string, token?: string): Promise<Record<string, any>> {
    const response = await fetch('/api/auth/complete-tilopay-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference, ...(token ? { token } : {}) })
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Error finalizando el registro.');
    return data;
  }

  /** Processes a saved card only against its server-created purchase intent. */
  public async createSubscription(reference: string, token: string): Promise<TilopaySubscriptionResponse> {
    try {
      const response = await fetch('/api/tilopay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', payload: { reference, token } })
      });
      const data = await response.json();
      if (!response.ok) {
        return { success: false, pending: Boolean(data.pending), error: data.error || 'Error al procesar la suscripción.' };
      }
      return {
        success: Boolean(data.success),
        pending: Boolean(data.pending),
        transactionId: data.transactionId,
        message: data.message
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Error de conexión con el servicio de pagos.'
      };
    }
  }
}

export const tilopayService = new TilopayService();
