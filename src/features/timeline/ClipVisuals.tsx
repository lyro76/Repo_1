import { useEffect, useRef } from 'react';
import type { Clip } from '@/types';
import { peakBetween, thumbnailIndex } from '@/lib/timeline/view';
import { useAnalysisStore } from '@/store/analysisStore';
import { PEAKS_PER_SECOND } from './mediaAnalysis';

type VisibleSpan = { from: number; to: number };

/** Miniatures d'un clip vidéo/image, uniquement sur la partie visible. */
export function Filmstrip({ clip, zoom, height, span }: { clip: Clip; zoom: number; height: number; span: VisibleSpan }) {
  const thumbs = useAnalysisStore((s) => (clip.mediaId ? s.thumbnails[clip.mediaId] : undefined));
  if (!thumbs || thumbs.urls.length === 0) return null;
  const tileWidth = Math.max(16, Math.round(height * thumbs.aspect));
  const first = Math.floor(span.from / tileWidth);
  const last = Math.ceil(span.to / tileWidth);
  const tiles: { x: number; url: string }[] = [];
  for (let i = first; i < last && tiles.length < 300; i++) {
    const x = i * tileWidth;
    const sourceTime = clip.type === 'image' ? 0 : clip.inPoint + ((x + tileWidth / 2) / zoom) * clip.speed;
    const url = thumbs.urls[thumbnailIndex(sourceTime, thumbs.interval, thumbs.urls.length)];
    if (url) tiles.push({ x, url });
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-70">
      {tiles.map((tile) => (
        <div
          key={tile.x}
          className="absolute top-0 bg-cover bg-center"
          style={{ left: tile.x, width: tileWidth, height, backgroundImage: `url(${tile.url})` }}
        />
      ))}
    </div>
  );
}

/** Forme d'onde dessinée sur un canevas couvrant la partie visible du clip. */
export function Waveform({
  clip,
  zoom,
  height,
  span,
  color,
  className = '',
}: {
  clip: Clip;
  zoom: number;
  height: number;
  span: VisibleSpan;
  color: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaks = useAnalysisStore((s) => (clip.mediaId ? s.peaks[clip.mediaId] : undefined));
  const width = Math.max(1, Math.ceil(span.to - span.from));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    const mid = height / 2;
    const gain = clip.muted ? 0.15 : Math.min(2, Math.max(0.15, clip.volume));
    for (let x = 0; x < width; x++) {
      const t0 = clip.inPoint + ((span.from + x) / zoom) * clip.speed;
      const t1 = clip.inPoint + ((span.from + x + 1) / zoom) * clip.speed;
      const amp = Math.min(1, peakBetween(peaks, PEAKS_PER_SECOND, t0, t1) * gain);
      const h = Math.max(1, amp * (height - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, width, height, span.from, zoom, clip.inPoint, clip.speed, clip.volume, clip.muted, color]);

  if (!peaks || peaks.length === 0) return null;
  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute ${className}`}
      style={{ left: span.from, width, height }}
    />
  );
}
