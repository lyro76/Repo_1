import type { Format } from '@/types';

export type FormatInfo = { width: number; height: number; label: string; hint: string };

export const FORMATS: Record<Format, FormatInfo> = {
  '9:16': { width: 1080, height: 1920, label: '9:16', hint: 'TikTok · Reels · Shorts' },
  '1:1': { width: 1080, height: 1080, label: '1:1', hint: 'Instagram carré' },
  '16:9': { width: 1920, height: 1080, label: '16:9', hint: 'YouTube' },
};

export const FORMAT_LIST: Format[] = ['9:16', '1:1', '16:9'];

export function formatSize(format: Format): { width: number; height: number } {
  const f = FORMATS[format];
  return { width: f.width, height: f.height };
}

export function aspectRatio(format: Format): number {
  const f = FORMATS[format];
  return f.width / f.height;
}
