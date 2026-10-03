// Géométrie pure du compositeur (testée avec Vitest).

export type Rect = { x: number; y: number; width: number; height: number };
export type PipShape = 'rounded' | 'circle' | 'square';
export type PipCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export type CaptureLayout = 'screenPip' | 'webcamOnly' | 'screenOnly';
export type ScreenFit = 'contain' | 'cover';
export type TextPosition = 'top' | 'center' | 'bottom';

export type PipSettings = {
  /** Centre de l'incrustation, normalisé (0..1). */
  x: number;
  y: number;
  /** Largeur de l'incrustation relative au plus petit côté du canevas (0.15..0.7). */
  size: number;
  shape: PipShape;
};

export const PIP_MIN_SIZE = 0.15;
export const PIP_MAX_SIZE = 0.7;
const PIP_MARGIN = 0.04;

/** Rectangle qui contient entièrement la source dans la destination (bandes éventuelles). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, width: dstW, height: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height };
}

/** Rectangle qui couvre toute la destination (la source est recadrée). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, width: dstW, height: dstH };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return { x: (dstW - width) / 2, y: (dstH - height) / 2, width, height };
}

/** Zone source à découper pour remplir une destination au ratio donné (recadrage centré). */
export function centerCropSource(srcW: number, srcH: number, targetAspect: number): Rect {
  const srcAspect = srcW / srcH;
  if (srcAspect > targetAspect) {
    const width = srcH * targetAspect;
    return { x: (srcW - width) / 2, y: 0, width, height: srcH };
  }
  const height = srcW / targetAspect;
  return { x: 0, y: (srcH - height) / 2, width: srcW, height };
}

/** Rectangle de l'incrustation webcam sur le canevas. */
export function pipRect(pip: PipSettings, canvasW: number, canvasH: number, webcamAspect: number): Rect {
  const base = Math.min(canvasW, canvasH);
  const size = Math.min(PIP_MAX_SIZE, Math.max(PIP_MIN_SIZE, pip.size));
  const aspect = pip.shape === 'circle' || pip.shape === 'square' ? 1 : webcamAspect > 0 ? webcamAspect : 16 / 9;
  const width = base * size;
  const height = width / aspect;
  const x = Math.min(canvasW - width, Math.max(0, pip.x * canvasW - width / 2));
  const y = Math.min(canvasH - height, Math.max(0, pip.y * canvasH - height / 2));
  return { x, y, width, height };
}

/** Position (centre normalisé) d'une incrustation placée dans un coin. */
export function pipCornerPosition(
  corner: PipCorner,
  pip: PipSettings,
  canvasW: number,
  canvasH: number,
  webcamAspect: number,
): { x: number; y: number } {
  const rect = pipRect({ ...pip, x: 0.5, y: 0.5 }, canvasW, canvasH, webcamAspect);
  const margin = Math.min(canvasW, canvasH) * PIP_MARGIN;
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  const cx = left ? margin + rect.width / 2 : canvasW - margin - rect.width / 2;
  const cy = top ? margin + rect.height / 2 : canvasH - margin - rect.height / 2;
  return { x: cx / canvasW, y: cy / canvasH };
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/** Ordonnée (normalisée) de la ligne de base du titre selon la position choisie. */
export function textAnchorY(position: TextPosition): number {
  if (position === 'top') return 0.12;
  if (position === 'center') return 0.5;
  return 0.84;
}

/** Découpe un texte en lignes qui tiennent dans `maxWidth` selon une fonction de mesure. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0] ?? '';
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (measure(candidate) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Temps d'enregistrement effectif, hors pauses. */
export function recordingElapsed(
  segments: { start: number; end?: number }[],
  now: number,
): number {
  return segments.reduce((sum, seg) => sum + Math.max(0, (seg.end ?? now) - seg.start), 0);
}
