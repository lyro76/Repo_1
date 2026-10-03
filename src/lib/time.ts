export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Arrondit un temps à la milliseconde pour éviter les dérives flottantes. */
export function roundTime(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function pad(n: number, size = 2): string {
  return String(n).padStart(size, '0');
}

/** Formate un temps en `mm:ss` ou `h:mm:ss`. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Formate un temps en `mm:ss.cc` (centièmes). */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const cs = Math.floor((safe % 1) * 100);
  return `${formatTime(safe)}.${pad(cs)}`;
}

/** Formate une durée lisible : « 1 min 05 s », « 12 s ». */
export function formatDurationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} s`;
  return `${m} min ${pad(s)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(timestamp).toLocaleDateString('fr-FR');
}

/** Choisit un pas de graduation « rond » en fonction du zoom (px par seconde). */
export function rulerStep(pixelsPerSecond: number, minPixels = 80): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const step of steps) {
    if (step * pixelsPerSecond >= minPixels) return step;
  }
  return steps[steps.length - 1] ?? 600;
}
