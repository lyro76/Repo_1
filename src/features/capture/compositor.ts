import { FORMATS } from '@/lib/formats';
import { roundRect, drawTextBlock } from '@/lib/drawText';
import { makeTextProps } from '@/lib/text';
import type { CaptureSettings } from '@/store/captureStore';
import { containRect, coverRect, centerCropSource, pipRect, textAnchorY, type Rect } from './layout';

export type Frame = { image: CanvasImageSource; width: number; height: number };

export type CompositorInput = {
  settings: CaptureSettings;
  screen: Frame | null;
  webcam: Frame | null;
};

/** Petit canevas réutilisé pour produire un fond flouté peu coûteux. */
let blurCanvas: HTMLCanvasElement | null = null;
let blurFrameCount = 0;
/** Le fond flou change peu : on ne le rafraîchit qu'une image sur 6. */
const BLUR_REFRESH_EVERY = 6;

function drawBlurredBackground(ctx: CanvasRenderingContext2D, frame: Frame, width: number, height: number) {
  if (!blurCanvas) blurCanvas = document.createElement('canvas');
  const small = blurCanvas;
  const smallHeight = Math.max(1, Math.round((48 * height) / width));
  const resized = small.width !== 48 || small.height !== smallHeight;
  if (resized) {
    small.width = 48;
    small.height = smallHeight;
  }
  const sctx = small.getContext('2d');
  if (!sctx) return;
  if (resized || blurFrameCount++ % BLUR_REFRESH_EVERY === 0) {
    const cover = coverRect(frame.width, frame.height, small.width, small.height);
    sctx.drawImage(frame.image, cover.x, cover.y, cover.width, cover.height);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawFrameInRect(ctx: CanvasRenderingContext2D, frame: Frame, rect: Rect, mirror = false) {
  const crop = centerCropSource(frame.width, frame.height, rect.width / rect.height);
  ctx.save();
  if (mirror) {
    ctx.translate(rect.x + rect.width, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame.image, crop.x, crop.y, crop.width, crop.height, 0, 0, rect.width, rect.height);
  } else {
    ctx.drawImage(frame.image, crop.x, crop.y, crop.width, crop.height, rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}

function drawFullFrame(ctx: CanvasRenderingContext2D, frame: Frame, width: number, height: number, fit: 'contain' | 'cover', mirror = false) {
  if (fit === 'contain') {
    drawBlurredBackground(ctx, frame, width, height);
    const rect = containRect(frame.width, frame.height, width, height);
    drawFrameInRect(ctx, frame, rect, mirror);
  } else {
    drawFrameInRect(ctx, frame, { x: 0, y: 0, width, height }, mirror);
  }
}

function drawPip(ctx: CanvasRenderingContext2D, frame: Frame, settings: CaptureSettings, width: number, height: number) {
  const rect = pipRect(settings.pip, width, height, frame.width / frame.height);
  const shape = settings.pip.shape;
  const radius = shape === 'circle' ? rect.width / 2 : shape === 'rounded' ? rect.width * 0.08 : 0;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = Math.min(width, height) * 0.02;
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.clip();
  drawFrameInRect(ctx, frame, rect, settings.mirrorWebcam);
  ctx.restore();

  ctx.save();
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.004);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, width: number, height: number, label: string) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#18181b');
  gradient.addColorStop(1, '#27272a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(161,161,170,0.8)';
  ctx.font = `500 ${Math.round(Math.min(width, height) * 0.035)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2);
}

function drawLiveTexts(ctx: CanvasRenderingContext2D, settings: CaptureSettings, width: number, height: number) {
  const y = textAnchorY(settings.textPosition);
  const title = settings.title.trim();
  const subtitle = settings.subtitle.trim();
  if (title) {
    drawTextBlock(ctx, makeTextProps({ text: title, color: settings.textColor, fontSize: 84, y, background: false, strokeWidth: 5 }), width, height);
  }
  if (subtitle) {
    const offset = title ? 0.065 : 0;
    drawTextBlock(
      ctx,
      makeTextProps({ text: subtitle, color: settings.textColor, fontSize: 50, bold: false, y: y + offset, strokeWidth: 3 }),
      width,
      height,
    );
  }
}

/** Dessine une image composée (écran, webcam, textes) sur le canevas. */
export function composeFrame(ctx: CanvasRenderingContext2D, input: CompositorInput, placeholder: string) {
  const { settings, screen, webcam } = input;
  const { width, height } = FORMATS[settings.format];
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const layout = settings.layout;
  if (layout === 'webcamOnly') {
    if (webcam) drawFullFrame(ctx, webcam, width, height, 'cover', settings.mirrorWebcam);
    else drawPlaceholder(ctx, width, height, placeholder);
  } else {
    if (screen) drawFullFrame(ctx, screen, width, height, settings.screenFit);
    else if (webcam && layout === 'screenPip') drawFullFrame(ctx, webcam, width, height, 'cover', settings.mirrorWebcam);
    else drawPlaceholder(ctx, width, height, placeholder);
    if (layout === 'screenPip' && screen && webcam) drawPip(ctx, webcam, settings, width, height);
  }
  drawLiveTexts(ctx, settings, width, height);
}
