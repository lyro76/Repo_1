import type { Format } from '@/types';
import { FORMATS } from '@/lib/formats';
import type { I18nKey } from '@/lib/i18n';

export type PresetId = 'tiktok' | 'square' | 'youtube';
export type Quality = 'good' | 'high';
export type Container = 'webm' | 'mp4';

export type ExportPreset = {
  id: PresetId;
  format: Format;
  width: number;
  height: number;
  labelKey: I18nKey;
  hintKey: I18nKey;
};

export const PRESETS: ExportPreset[] = [
  { id: 'tiktok', format: '9:16', ...FORMATS['9:16'], labelKey: 'export.preset.tiktok', hintKey: 'export.preset.tiktok.hint' },
  { id: 'square', format: '1:1', ...FORMATS['1:1'], labelKey: 'export.preset.square', hintKey: 'export.preset.square.hint' },
  { id: 'youtube', format: '16:9', ...FORMATS['16:9'], labelKey: 'export.preset.youtube', hintKey: 'export.preset.youtube.hint' },
];

export type ExportSettings = {
  preset: PresetId;
  quality: Quality;
  fps: 30 | 60;
  container: Container;
};

export function getPreset(id: PresetId): ExportPreset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as ExportPreset);
}

export function presetForFormat(format: Format): PresetId {
  return PRESETS.find((p) => p.format === format)?.id ?? 'tiktok';
}

/** Débit vidéo (bits/s) du rendu intermédiaire selon résolution, ips et qualité. */
export function videoBitrate(width: number, height: number, fps: number, quality: Quality): number {
  const bitsPerPixel = quality === 'high' ? 0.16 : 0.09;
  return Math.round(width * height * fps * bitsPerPixel);
}

export const AUDIO_BITRATE = 192_000;

/** Arguments ffmpeg pour convertir le rendu WebM en MP4 H.264 + AAC lisible partout. */
export function mp4Args(settings: ExportSettings, input: string, output: string): string[] {
  const high = settings.quality === 'high';
  return [
    '-i', input,
    '-c:v', 'libx264',
    '-preset', high ? 'veryfast' : 'ultrafast',
    '-crf', high ? '19' : '23',
    '-pix_fmt', 'yuv420p',
    '-r', String(settings.fps),
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    output,
  ];
}

/** Extrait le temps traité (s) d'une ligne de log ffmpeg (« time=00:00:05.12 »). */
export function parseFfmpegTime(line: string): number | undefined {
  const match = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Nom de fichier sûr à partir du nom du projet. */
export function exportFileName(name: string, container: Container): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'clipstudio';
  return `${base}.${container}`;
}

/** Progression globale (0..1) selon la phase : le rendu compte pour 60 % quand on convertit en MP4. */
export function overallProgress(phase: 'render' | 'load' | 'encode', ratio: number, container: Container): number {
  const r = Math.min(1, Math.max(0, ratio));
  if (container === 'webm') return phase === 'render' ? r : 1;
  if (phase === 'render') return r * 0.6;
  if (phase === 'load') return 0.6;
  return 0.6 + r * 0.4;
}
