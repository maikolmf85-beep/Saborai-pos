// Web Audio API Sound Effects Engine for Restaurant POS (Cocina, Bar y Saloneros)

class SoundEffectsService {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    try {
      const savedMute = localStorage.getItem('saborai_sound_muted');
      if (savedMute !== null) {
        this.muted = JSON.parse(savedMute);
      }
    } catch {
      this.muted = false;
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.ctx = new AudioContextClass();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem('saborai_sound_muted', JSON.stringify(this.muted));
    } catch {}
    return this.muted;
  }

  // 1. Campana de Nueva Comanda para Cocina y Bar (Sonido de Timbre de Comanda / Dual Chime)
  playNewOrderSound(station: 'Cocina' | 'Bar' | 'General' = 'General'): void {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Note 1 (Campana inicial)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(station === 'Bar' ? 784 : 587.33, now); // G5 or D5
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Note 2 (Campana de resonancia)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(station === 'Bar' ? 1046.5 : 880, now + 0.15); // C6 or A5
      gain2.gain.setValueAtTime(0.4, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.7);
    } catch {
      // ignore audio context restrictions
    }
  }

  // 2. Timbre de Servicio Listo para Saloneros ("Ding! Platillo o Bebida Lista")
  playOrderReadySound(): void {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Authentic Brass Call Bell ("Ding!")
      const freqs = [1568, 2093, 2637]; // High harmonic triad
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        const startTime = now + idx * 0.08;
        const duration = 0.8;
        gain.gain.setValueAtTime(0.25, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    } catch {
      // ignore audio context restrictions
    }
  }

  // 3. Sonido sutil de clic de tecla (PIN Pad)
  playKeyClickSound(): void {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.03);
    } catch {}
  }

  // 4. Sonido de Éxito / Turno Cambiado (Doble tono ascendente armónico)
  playSuccessChime(): void {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.09);
        gain.gain.setValueAtTime(0.2, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.35);
      });
    } catch {}
  }

  // 5. Sonido de Error / PIN Inválido (Tono grave de advertencia)
  playErrorBuzz(): void {
    if (this.muted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [220, 185].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.18);
      });
    } catch {}
  }
}

export const soundService = new SoundEffectsService();
