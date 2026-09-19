export interface TilopayCardData {
  cardNumber: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  cardholderName: string;
}

export interface TilopaySubscriptionResponse {
  success: boolean;
  transactionId?: string;
  message?: string;
  error?: string;
}

class TilopayService {
  /**
   * Simula la tokenización segura de una tarjeta de crédito
   * @param cardData 
   * @returns un string con el token (o un error si la tarjeta es declinada explícitamente)
   */
  public async tokenizeCard(cardData: TilopayCardData): Promise<string> {
    return new Promise((resolve, reject) => {
      // Simulate network latency (1.5 - 2.5s)
      const delay = Math.floor(Math.random() * 1000) + 1500;

      setTimeout(() => {
        // Mock error condition: CVV '999' forces a validation failure
        if (cardData.cvv === '999') {
          reject(new Error('Tarjeta declinada por el banco emisor (Fondos Insuficientes / CVV Inválido).'));
          return;
        }

        // Mock error condition: Card ending in '0000' forces block
        if (cardData.cardNumber.replace(/\s+/g, '').endsWith('0000')) {
          reject(new Error('Tarjeta bloqueada por sospecha de fraude.'));
          return;
        }

        // Generate a mock token
        const token = `tilo_tok_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
        resolve(token);
      }, delay);
    });
  }

  /**
   * Simula la inscripción de una tarjeta tokenizada a un plan de suscripción mensual
   * @param planId El ID del plan (express, pro, enterprise)
   * @param token El token generado en el paso anterior
   * @param email Correo del cliente
   */
  public async createSubscription(planId: string, token: string, email: string): Promise<TilopaySubscriptionResponse> {
    return new Promise((resolve) => {
      const delay = Math.floor(Math.random() * 1000) + 1000;

      setTimeout(() => {
        if (!token.startsWith('tilo_tok_')) {
          resolve({
            success: false,
            error: 'Token de pago inválido.'
          });
          return;
        }

        resolve({
          success: true,
          transactionId: `sub_txn_${Date.now()}`,
          message: `Suscripción al plan '${planId}' procesada correctamente para ${email}.`
        });
      }, delay);
    });
  }
}

export const tilopayService = new TilopayService();
