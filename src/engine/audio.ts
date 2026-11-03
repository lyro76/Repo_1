/** Effets sonores synthétisés (WebAudio) : rien à charger. */
export class Sfx {
  ctx: AudioContext | null = null;
  muted = false;
  private master: GainNode | null = null;

  /** À appeler sur la première interaction (les navigateurs l'exigent). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType = "square", vol = 1) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  jump() { this.tone(300, 700, 0.18, "square", 0.6); }
  slide() { this.tone(400, 150, 0.2, "sawtooth", 0.4); }
  lane() { this.tone(500, 650, 0.06, "triangle", 0.5); }
  coin() { this.tone(900, 1400, 0.12, "sine", 0.7); this.tone(1400, 1800, 0.1, "sine", 0.4); }
  hit() { this.tone(200, 40, 0.5, "sawtooth", 0.9); }
  land() { this.tone(120, 80, 0.08, "triangle", 0.5); }
  fanfare() { for (let i = 0; i < 4; i++) setTimeout(() => this.tone(600 + i * 200, 900 + i * 200, 0.15, "sine", 0.5), i * 90); }
}
