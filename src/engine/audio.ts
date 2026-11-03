/** Sons synthétisés (aucun fichier). Démarre au premier geste de l'utilisateur. */
export class Audio {
  private ac: AudioContext | null = null;
  muted = false;
  unlock() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ac = this.ac || new AC();
      if (this.ac.state === "suspended") void this.ac.resume();
    } catch { /* pas d'audio */ }
  }
  tone(freq: number, dur = 0.4, gain = 0.25, type: OscillatorType = "sine") {
    if (this.muted || !this.ac) return;
    try {
      const o = this.ac.createOscillator(), g = this.ac.createGain(), t = this.ac.currentTime;
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ac.destination);
      o.start(); o.stop(t + dur + 0.05);
    } catch { /* ignore */ }
  }
  tick() { this.tone(880, 0.08, 0.15, "square"); }
  good() { this.tone(660, 0.15, 0.15); setTimeout(() => this.tone(880, 0.2, 0.15), 90); }
  bad() { this.tone(180, 0.25, 0.2, "triangle"); }
}
