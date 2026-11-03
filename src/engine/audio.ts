/** Sons de flipper synthétisés : aucun fichier audio. */
export class Sfx {
  private ac: AudioContext | null = null;
  muted = false;
  unlock() { try { const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; this.ac = this.ac || new AC(); if (this.ac.state === "suspended") void this.ac.resume(); } catch { /* pas d'audio */ } }
  private osc(freq: number, dur: number, gain: number, type: OscillatorType, slide = 1) {
    if (this.muted || !this.ac) return;
    try { const t = this.ac.currentTime, o = this.ac.createOscillator(), g = this.ac.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(this.ac.destination); o.start(t); o.stop(t + dur + 0.02); } catch { /* ignore */ }
  }
  private noise(dur: number, gain: number) {
    if (this.muted || !this.ac) return;
    try { const t = this.ac.currentTime, n = Math.floor(this.ac.sampleRate * dur), buf = this.ac.createBuffer(1, n, this.ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = this.ac.createBufferSource(), g = this.ac.createGain(), f = this.ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1200; s.buffer = buf; g.gain.value = gain; s.connect(f).connect(g).connect(this.ac.destination); s.start(t); } catch { /* ignore */ }
  }
  flipper() { this.noise(0.04, 0.25); this.osc(140, 0.06, 0.2, "square", 0.6); }
  bumper() { this.osc(520, 0.12, 0.3, "square", 0.5); this.noise(0.03, 0.2); }
  sling() { this.osc(300, 0.08, 0.25, "sawtooth", 0.7); }
  target() { this.osc(880, 0.1, 0.2, "triangle", 1.5); }
  drop() { this.osc(220, 0.15, 0.25, "square", 0.4); this.noise(0.05, 0.2); }
  wall(speed: number) { const g = Math.min(0.18, speed / 6000); if (g > 0.02) this.noise(0.02, g); }
  spinner() { this.osc(1200, 0.03, 0.08, "square", 0.9); }
  lane() { this.osc(660, 0.12, 0.15, "sine", 1.3); }
  launch() { this.noise(0.12, 0.3); this.osc(90, 0.25, 0.3, "sawtooth", 3); }
  drain() { this.osc(300, 0.5, 0.25, "sawtooth", 0.25); }
  jackpot() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.osc(f, 0.25, 0.25, "square", 1), i * 90)); }
  world() { [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.osc(f, 0.3, 0.2, "triangle", 1), i * 70)); }
  tilt() { this.osc(120, 0.8, 0.3, "sawtooth", 0.5); }
  extra() { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.osc(f, 0.2, 0.2, "sine", 1), i * 80)); }
  wheel() { this.osc(1500, 0.02, 0.06, "square", 1); }
  nudge() { this.noise(0.06, 0.3); }
}
