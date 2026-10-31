export type HeuristicCategory =
  | 'HARDWARE_RESILIENCE'
  | 'DGT_TAX_INTELLIGENCE'
  | 'KITCHEN_SPEED'
  | 'FINANCIAL_VELOCITY'
  | 'SYSTEM_HYGIENE';

export interface NyzaHeuristic {
  id: string;
  category: HeuristicCategory;
  title: string;
  description: string;
  createdAt: string;
  source: 'HUMAN_SUPERVISOR_TEACHING';
  status: 'ACTIVE' | 'MUTED';
}

export interface DailyLearningCycle {
  id: string;
  date: string;
  timestamp: string;
  observationsCount: number;
  summary: string;
  discoveredHeuristics: NyzaHeuristic[];
  source: 'LOCAL_OBSERVATION_SUMMARY';
}

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  type: 'PRINTER_RESPONSE' | 'DGT_PING' | 'KITCHEN_TICKET' | 'PAYMENT_COMPLETED' | 'DB_QUERY' | 'SYSTEM_ERROR' | 'SELF_HEALING_RUN';
  durationMs: number;
  status: 'OK' | 'WARN' | 'ERROR';
  metadata: Record<string, unknown>;
}

const STORAGE_KEYS = {
  HEURISTICS: 'saborai_nyza_heuristics',
  CYCLES: 'saborai_nyza_daily_cycles'
};

const CATEGORIES: HeuristicCategory[] = [
  'HARDWARE_RESILIENCE',
  'DGT_TAX_INTELLIGENCE',
  'KITCHEN_SPEED',
  'FINANCIAL_VELOCITY',
  'SYSTEM_HYGIENE'
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class NyzaLearningService {
  private static instance: NyzaLearningService;
  private heuristics: NyzaHeuristic[] = [];
  private dailyCycles: DailyLearningCycle[] = [];
  private telemetryBuffer: TelemetryEvent[] = [];
  private listeners: (() => void)[] = [];
  private tenantId = 'unscoped';

  private constructor() {
    // Los ciclos legados contenían métricas de muestra y nunca se migran.
    try { localStorage.removeItem(STORAGE_KEYS.CYCLES); } catch {}
    this.loadState();
  }

  public static getInstance(): NyzaLearningService {
    if (!NyzaLearningService.instance) {
      NyzaLearningService.instance = new NyzaLearningService();
    }
    return NyzaLearningService.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(existing => existing !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  private scopedStorageKey(key: keyof typeof STORAGE_KEYS): string {
    return `${STORAGE_KEYS[key]}::${encodeURIComponent(this.tenantId)}`;
  }

  public setTenantId(tenantId: string): void {
    const normalizedId = (tenantId || 'unscoped').trim().slice(0, 120) || 'unscoped';
    if (normalizedId === this.tenantId) return;
    this.tenantId = normalizedId;
    this.heuristics = [];
    this.dailyCycles = [];
    this.telemetryBuffer = [];
    this.loadState();
    this.notify();
  }

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const rawHeuristics = localStorage.getItem(this.scopedStorageKey('HEURISTICS'));
      const parsedHeuristics: unknown = rawHeuristics ? JSON.parse(rawHeuristics) : [];
      this.heuristics = Array.isArray(parsedHeuristics)
        ? parsedHeuristics.flatMap((entry): NyzaHeuristic[] => {
            if (!isPlainObject(entry) || entry.source !== 'HUMAN_SUPERVISOR_TEACHING') return [];
            const category = CATEGORIES.find(candidate => candidate === entry.category);
            const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 120) : '';
            const description = typeof entry.description === 'string' ? entry.description.trim().slice(0, 1200) : '';
            if (!category || !title || !description) return [];
            return [{
              id: typeof entry.id === 'string' ? entry.id : `HEUR-HUM-${Date.now()}`,
              category,
              title,
              description,
              createdAt: typeof entry.createdAt === 'string'
                ? entry.createdAt
                : typeof entry.lastTriggered === 'string' ? entry.lastTriggered : new Date().toISOString(),
              source: 'HUMAN_SUPERVISOR_TEACHING',
              status: entry.status === 'MUTED' ? 'MUTED' : 'ACTIVE'
            }];
          })
        : [];
      this.saveHeuristics();

      // Los ciclos históricos anteriores contenían valores de muestra, no mediciones.
      // Solo se conserva el formato nuevo, que registra el tamaño real del búfer local.
      const rawCycles = localStorage.getItem(this.scopedStorageKey('CYCLES'));
      const parsedCycles: unknown = rawCycles ? JSON.parse(rawCycles) : [];
      this.dailyCycles = Array.isArray(parsedCycles)
        ? parsedCycles.filter((entry): entry is DailyLearningCycle =>
            isPlainObject(entry)
            && entry.source === 'LOCAL_OBSERVATION_SUMMARY'
            && Number.isInteger(entry.observationsCount)
            && typeof entry.summary === 'string'
            && typeof entry.timestamp === 'string'
            && Array.isArray(entry.discoveredHeuristics)
          )
        : [];
      this.saveCycles();
    } catch (error) {
      console.warn('No se pudo cargar el estado local de Nyza; se inicia sin métricas no verificadas.', error);
      this.heuristics = [];
      this.dailyCycles = [];
      this.saveHeuristics();
      this.saveCycles();
    }
  }

  private saveHeuristics(): void {
    try {
      localStorage.setItem(this.scopedStorageKey('HEURISTICS'), JSON.stringify(this.heuristics));
    } catch {}
  }

  private saveCycles(): void {
    try {
      localStorage.setItem(this.scopedStorageKey('CYCLES'), JSON.stringify(this.dailyCycles));
    } catch {}
  }

  public logObservation(
    type: TelemetryEvent['type'],
    durationMs: number,
    status: TelemetryEvent['status'],
    metadata: Record<string, unknown> = {}
  ): void {
    this.telemetryBuffer.push({
      id: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      durationMs: Math.max(0, Number.isFinite(durationMs) ? durationMs : 0),
      status,
      metadata
    });
    if (this.telemetryBuffer.length > 200) this.telemetryBuffer.shift();
  }

  /** Registra un resumen manual de eventos observados en memoria; no entrena el modelo. */
  public runDailyLearningCycle(_manualTrigger = false): DailyLearningCycle {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const cycle: DailyLearningCycle = {
      id: `LOCAL-${date}-${Date.now().toString().slice(-6)}`,
      date,
      timestamp: now.toISOString(),
      observationsCount: this.telemetryBuffer.length,
      summary: `Resumen local de ${this.telemetryBuffer.length} observación(es) disponibles en memoria. No modifica el modelo de IA ni sincroniza datos con una red global.`,
      discoveredHeuristics: [],
      source: 'LOCAL_OBSERVATION_SUMMARY'
    };
    this.dailyCycles.unshift(cycle);
    this.dailyCycles = this.dailyCycles.slice(0, 30);
    this.saveCycles();
    this.notify();
    return cycle;
  }

  /** Guarda una nota local del equipo; no modifica ni reentrena el modelo de IA. */
  public teachNyza(
    category: HeuristicCategory,
    title: string,
    ruleDescription: string,
    _impact: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'HIGH'
  ): NyzaHeuristic {
    if (!CATEGORIES.includes(category)) throw new Error('Categoría de regla no válida.');
    const cleanTitle = title.trim().slice(0, 120);
    const cleanDescription = ruleDescription.trim().slice(0, 1200);
    if (!cleanTitle || !cleanDescription) throw new Error('La regla necesita un título y una descripción.');

    const note: NyzaHeuristic = {
      id: `HEUR-HUM-${Date.now().toString().slice(-8)}`,
      category,
      title: cleanTitle,
      description: cleanDescription,
      createdAt: new Date().toISOString(),
      source: 'HUMAN_SUPERVISOR_TEACHING',
      status: 'ACTIVE'
    };
    this.heuristics.unshift(note);
    this.saveHeuristics();
    this.notify();
    return note;
  }

  public toggleHeuristicStatus(id: string): void {
    const heuristic = this.heuristics.find(item => item.id === id);
    if (!heuristic) return;
    heuristic.status = heuristic.status === 'ACTIVE' ? 'MUTED' : 'ACTIVE';
    this.saveHeuristics();
    this.notify();
  }

  public getHeuristics(): NyzaHeuristic[] {
    return this.heuristics.map(heuristic => ({ ...heuristic }));
  }

  public getDailyCycles(): DailyLearningCycle[] {
    return this.dailyCycles.map(cycle => ({ ...cycle, discoveredHeuristics: [] }));
  }

  public getObservationCount(): number {
    return this.telemetryBuffer.length;
  }

  public getLocalLearningSummary(): string {
    const activeNotes = this.heuristics.filter(note => note.status === 'ACTIVE');
    if (activeNotes.length === 0) {
      return 'No hay reglas locales activas. Nyza no entrena el modelo, no tiene un puntaje de IQ verificable ni sincroniza aprendizaje global en esta versión.';
    }
    const noteList = activeNotes.slice(0, 8)
      .map(note => `- ${note.title}: ${note.description}`)
      .join('\n');
    return `Nyza no entrena el modelo ni sincroniza aprendizaje global en esta versión. Estas son notas locales creadas por el equipo (${activeNotes.length} activas):\n${noteList}`;
  }
}

export const nyzaLearningService = NyzaLearningService.getInstance();
