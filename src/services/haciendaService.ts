import { ElectronicInvoiceCR } from '../types';

class HaciendaService {
  private invoices: ElectronicInvoiceCR[] = [];
  private listeners: ((invoices: ElectronicInvoiceCR[]) => void)[] = [];

  constructor() {
    // Load from local storage if available
    const saved = localStorage.getItem('saborai_hacienda_invoices');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Revive dates
        this.invoices = parsed.map((inv: any) => ({
          ...inv,
          fechaEmision: new Date(inv.fechaEmision)
        }));
      } catch (e) {
        console.error('Failed to load hacienda invoices', e);
      }
    }
  }

  private persist() {
    localStorage.setItem('saborai_hacienda_invoices', JSON.stringify(this.invoices));
    this.notifyListeners();
  }

  public subscribe(listener: (invoices: ElectronicInvoiceCR[]) => void) {
    this.listeners.push(listener);
    listener(this.invoices);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.invoices]));
  }

  public getInvoices(): ElectronicInvoiceCR[] {
    return [...this.invoices];
  }

  public emitInvoice(invoice: ElectronicInvoiceCR, onStatusChange?: (status: string) => void) {
    // Save invoice as processing initially
    const newInvoice: ElectronicInvoiceCR = {
      ...invoice,
      estadoHacienda: 'PROCESANDO'
    };
    
    this.invoices = [newInvoice, ...this.invoices];
    this.persist();

    if (onStatusChange) onStatusChange('PROCESANDO');

    // Call backend API
    fetch('/api/hacienda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        xmlBase64: typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(invoice.xmlContent || ''))) : '',
        clave: invoice.clave50Digitos,
        fecha: invoice.fechaEmision,
        emisor: invoice.emisor,
        receptor: invoice.receptor
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        this.updateInvoiceStatus(invoice.clave50Digitos, 'ACEPTADO'); // In real life, wait for webhook
        if (onStatusChange) onStatusChange('ACEPTADO');
      } else {
        this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO');
        if (onStatusChange) onStatusChange('RECHAZADO');
        console.error('Hacienda API Error:', data);
      }
    })
    .catch(err => {
      console.error('Hacienda Network Error:', err);
      this.updateInvoiceStatus(invoice.clave50Digitos, 'RECHAZADO');
      if (onStatusChange) onStatusChange('RECHAZADO');
    });
  }

  public resendInvoice(clave: string, onStatusChange?: (status: string) => void) {
    this.updateInvoiceStatus(clave, 'PROCESANDO');
    if (onStatusChange) onStatusChange('PROCESANDO');

    setTimeout(() => {
      this.updateInvoiceStatus(clave, 'ACEPTADO');
      if (onStatusChange) onStatusChange('ACEPTADO');
    }, 2000);
  }

  private updateInvoiceStatus(clave: string, status: 'ACEPTADO' | 'PROCESANDO' | 'RECHAZADO') {
    this.invoices = this.invoices.map(inv => 
      inv.clave50Digitos === clave ? { ...inv, estadoHacienda: status } : inv
    );
    this.persist();
  }
}

export const haciendaService = new HaciendaService();
