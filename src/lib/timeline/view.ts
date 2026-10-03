// Conversions et calculs d'affichage de la timeline (fonctions pures).

export function timeToPx(time: number, zoom: number): number {
  return time * zoom;
}

export function pxToTime(px: number, zoom: number): number {
  return zoom > 0 ? px / zoom : 0;
}

/**
 * Nouveau défilement horizontal après un zoom, pour que l'instant situé sous
 * `anchorPx` (position dans la zone visible) reste sous le pointeur.
 */
export function scrollForZoom(oldZoom: number, newZoom: number, anchorPx: number, scrollLeft: number): number {
  const time = (scrollLeft + anchorPx) / oldZoom;
  return Math.max(0, time * newZoom - anchorPx);
}

/** Zoom qui fait tenir `duration` secondes dans `viewportPx` pixels. */
export function fitZoom(duration: number, viewportPx: number, min: number, max: number): number {
  if (duration <= 0 || viewportPx <= 0) return Math.min(max, Math.max(min, 60));
  return Math.min(max, Math.max(min, (viewportPx * 0.92) / duration));
}

export function visibleRange(scrollLeft: number, viewportPx: number, zoom: number): { start: number; end: number } {
  return { start: pxToTime(scrollLeft, zoom), end: pxToTime(scrollLeft + viewportPx, zoom) };
}

/** Seuil d'aimantation en secondes pour un seuil en pixels. */
export function snapThreshold(px: number, zoom: number): number {
  return pxToTime(px, zoom);
}

/** Facteur de zoom pour un pas de molette (deltaY négatif = zoom avant). */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0025);
}

/** Index de la miniature à afficher pour un temps source. */
export function thumbnailIndex(sourceTime: number, interval: number, count: number): number {
  if (count <= 0) return 0;
  if (interval <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(sourceTime / interval)));
}

/**
 * Pics d'amplitude (0..1) d'un signal audio, `peaksPerSecond` valeurs par seconde,
 * en prenant le maximum absolu sur tous les canaux.
 */
export function computePeaks(channels: Float32Array[], sampleRate: number, peaksPerSecond: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || sampleRate <= 0 || peaksPerSecond <= 0) return new Float32Array(0);
  const samplesPerPeak = Math.max(1, Math.floor(sampleRate / peaksPerSecond));
  const count = Math.ceil(length / samplesPerPeak);
  const peaks = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const from = i * samplesPerPeak;
    const to = Math.min(length, from + samplesPerPeak);
    let max = 0;
    for (const channel of channels) {
      for (let s = from; s < to; s++) {
        const v = Math.abs(channel[s] ?? 0);
        if (v > max) max = v;
      }
    }
    peaks[i] = Math.min(1, max);
  }
  return peaks;
}

/** Maximum des pics entre deux temps source (pour dessiner une colonne de pixels). */
export function peakBetween(peaks: Float32Array, peaksPerSecond: number, from: number, to: number): number {
  if (peaks.length === 0) return 0;
  let a = Math.floor(Math.min(from, to) * peaksPerSecond);
  let b = Math.ceil(Math.max(from, to) * peaksPerSecond);
  a = Math.max(0, Math.min(peaks.length - 1, a));
  b = Math.max(a + 1, Math.min(peaks.length, b));
  let max = 0;
  for (let i = a; i < b; i++) {
    const v = peaks[i] ?? 0;
    if (v > max) max = v;
  }
  return max;
}
