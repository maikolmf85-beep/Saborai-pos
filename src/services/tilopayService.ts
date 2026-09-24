export interface TilopayPaymentRequest {
  email: string;
  firstName: string;
  lastName: string;
  planId: string;
  redirect: string;
}

export interface TilopaySubscriptionResponse {
  success: boolean;
  transactionId?: string;
  message?: string;
  error?: string;
}

class TilopayService {
  /**
   * Genera el link de pago seguro de TiloPay
   */
  public async getPaymentUrl(request: TilopayPaymentRequest): Promise<string> {
    try {
      const response = await fetch('/api/tilopay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'tokenize',
          payload: request
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al conectar con la pasarela de pagos.');
      }

      return data.url;
    } catch (error: any) {
      throw new Error(error.message || 'Error de conexión con el servicio de pagos.');
    }
  }

  /**
   * Inscribe una tarjeta tokenizada a un plan de suscripción mensual vía el backend seguro
   * @param planId El ID del plan (express, pro, enterprise)
   * @param token El token generado en el paso anterior
   * @param email Correo del cliente
   */
  public async createSubscription(planId: string, token: string, email: string): Promise<TilopaySubscriptionResponse> {
    try {
      const response = await fetch('/api/tilopay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'subscribe',
          payload: { planId, token, email }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || 'Error al procesar la suscripción.'
        };
      }

      return {
        success: true,
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
