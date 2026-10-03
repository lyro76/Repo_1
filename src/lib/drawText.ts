import type { TextProps } from '@/types';
import { wrapText } from '@/features/capture/layout';

/**
 * Dessine un bloc de texte centré sur (x, y) normalisés.
 * `scale` permet d'adapter la taille de police à la résolution du canevas (référence : 1080 px de large).
 */
export function drawTextBlock(ctx: CanvasRenderingContext2D, props: TextProps, width: number, height: number, alpha = 1) {
  if (!props.text.trim()) return;
  const scale = Math.min(width, height) / 1080;
  const fontSize = Math.max(8, props.fontSize * scale);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${props.bold ? '700' : '400'} ${fontSize}px ${props.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = props.align;
  ctx.lineJoin = 'round';

  const maxWidth = width * 0.9;
  const lines = wrapText(props.text, maxWidth, (s) => ctx.measureText(s).width);
  const lineHeight = fontSize * 1.2;
  const blockHeight = lines.length * lineHeight;
  const cx = props.x * width;
  const cy = props.y * height;
  const anchorX = props.align === 'left' ? cx - maxWidth / 2 : props.align === 'right' ? cx + maxWidth / 2 : cx;
  const top = cy - blockHeight / 2 + lineHeight / 2;

  if (props.background) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = fontSize * 0.4;
    const padY = fontSize * 0.2;
    const left = props.align === 'left' ? anchorX : props.align === 'right' ? anchorX - widest : cx - widest / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, left - padX, cy - blockHeight / 2 - padY, widest + padX * 2, blockHeight + padY * 2, fontSize * 0.25);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    if (props.strokeWidth > 0) {
      ctx.strokeStyle = props.strokeColor;
      ctx.lineWidth = props.strokeWidth * scale * 2;
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = props.color;
    ctx.fillText(line, anchorX, y);
  });
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
