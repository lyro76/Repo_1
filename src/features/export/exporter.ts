import fixWebmDuration from 'fix-webm-duration';
import { t } from '@/lib/i18n';
import type { Project } from '@/types';
import { FORMATS } from '@/lib/formats';
import { createTicker } from '@/lib/ticker';
import { pickRecorderMimeType, VIDEO_RECORDER_TYPES } from '@/lib/media';
import { projectDuration } from '@/lib/timeline/clips';
import { containRect } from '@/features/capture/layout';
import { MediaPool } from '@/features/preview/mediaPool';
import { renderFrame } from '@/features/preview/renderFrame';
import { AUDIO_BITRATE, getPreset, mp4Args, parseFfmpegTime, videoBitrate, type ExportSettings } from './presets';
import { loadFfmpeg, terminateFfmpeg } from './ffmpeg';

export type ExportPhase = 'render' | 'load' | 'encode';
export type ProgressHandler = (phase: ExportPhase, ratio: number) => void;

export class ExportCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ExportCancelled';
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new ExportCancelled();
}

/** Attend que les vidéos visibles au début soient prêtes (ou un délai maximal). */
async function warmUp(pool: MediaPool, project: Project, signal: AbortSignal) {
  pool.sync(project, 0, false, true);
  const deadline = performance.now() + 4000;
  const firstClips = Object.values(project.clips).filter((c) => c.type === 'video' && c.start <= 0.05);
  while (performance.now() < deadline) {
    throwIfAborted(signal);
    if (firstClips.every((c) => pool.videoFor(c))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Rendu temps réel de la timeline : canevas + mixage audio enregistrés
 * par MediaRecorder. Retourne un WebM.
 */
export async function renderToWebm(
  project: Project,
  mediaUrls: Record<string, string>,
  settings: ExportSettings,
  onProgress: ProgressHandler,
  signal: AbortSignal,
): Promise<Blob> {
  const duration = projectDuration(project);
  const preset = getPreset(settings.preset);
  const mimeType = pickRecorderMimeType(VIDEO_RECORDER_TYPES);
  if (!mimeType) throw new Error(t('error.recorder'));

  // Canevas de sortie au format du préréglage.
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error(t('error.canvas'));

  // Le projet est rendu à son propre format puis placé (bandes noires si besoin).
  const projectSize = FORMATS[project.format];
  const placement = containRect(projectSize.width, projectSize.height, preset.width, preset.height);
  const sameFormat = Math.abs(placement.width - preset.width) < 1 && Math.abs(placement.height - preset.height) < 1;
  const stage = sameFormat ? canvas : document.createElement('canvas');
  if (!sameFormat) {
    stage.width = Math.round(placement.width);
    stage.height = Math.round(placement.height);
  }
  const stageCtx = sameFormat ? ctx : stage.getContext('2d', { alpha: false });
  if (!stageCtx) throw new Error(t('error.canvas'));

  const audioCtx = new AudioContext({ sampleRate: 48000 });
  await audioCtx.resume();
  const destination = audioCtx.createMediaStreamDestination();
  const pool = new MediaPool(audioCtx, destination, (id) => mediaUrls[id]);

  const cleanup = () => {
    pool.dispose();
    void audioCtx.close();
  };

  try {
    await warmUp(pool, project, signal);

    const draw = (time: number) => {
      renderFrame(stageCtx, project, time, pool);
      if (!sameFormat) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(stage, placement.x, placement.y, placement.width, placement.height);
      }
    };
    draw(0);

    const videoStream = canvas.captureStream(settings.fps);
    const tracks = [...videoStream.getVideoTracks(), ...destination.stream.getAudioTracks()];
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: videoBitrate(preset.width, preset.height, settings.fps, settings.quality),
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    await new Promise<void>((resolve, reject) => {
      let stopTicker: (() => void) | null = null;
      let lastReport = 0;
      const finish = (error?: Error) => {
        stopTicker?.();
        stopTicker = null;
        signal.removeEventListener('abort', onAbort);
        if (recorder.state !== 'inactive') recorder.stop();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(new ExportCancelled());
      signal.addEventListener('abort', onAbort);

      recorder.start(1000);
      const startedAt = performance.now();
      pool.sync(project, 0, true, true);
      stopTicker = createTicker(settings.fps, () => {
        const time = (performance.now() - startedAt) / 1000;
        if (time >= duration) {
          draw(Math.max(0, duration - 0.001));
          onProgress('render', 1);
          // Laisse le temps à la dernière image d'être capturée.
          setTimeout(() => finish(), 120);
          stopTicker?.();
          stopTicker = null;
          return;
        }
        pool.sync(project, time, true);
        draw(time);
        if (time - lastReport > 0.1) {
          lastReport = time;
          onProgress('render', time / duration);
        }
      });
    });

    await stopped;
    videoStream.getTracks().forEach((track) => track.stop());
    const raw = new Blob(chunks, { type: mimeType.split(';')[0] });
    return await fixWebmDuration(raw, duration * 1000, { logger: false });
  } finally {
    cleanup();
  }
}

/** Conversion du WebM en MP4 (H.264 + AAC) avec ffmpeg.wasm. */
export async function convertToMp4(
  webm: Blob,
  duration: number,
  settings: ExportSettings,
  onProgress: ProgressHandler,
  signal: AbortSignal,
): Promise<Blob> {
  onProgress('load', 0);
  const onAbort = () => terminateFfmpeg();
  signal.addEventListener('abort', onAbort);
  try {
    const ffmpeg = await loadFfmpeg();
    throwIfAborted(signal);
    const logHandler = ({ message }: { message: string }) => {
      const time = parseFfmpegTime(message);
      if (time !== undefined && duration > 0) onProgress('encode', time / duration);
    };
    ffmpeg.on('log', logHandler);
    try {
      await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()));
      onProgress('encode', 0);
      const code = await ffmpeg.exec(mp4Args(settings, 'input.webm', 'output.mp4'));
      throwIfAborted(signal);
      if (code !== 0) throw new Error(t('error.ffmpegCode', { code }));
      const data = await ffmpeg.readFile('output.mp4');
      if (typeof data === 'string') throw new Error(t('error.ffmpegOutput'));
      await ffmpeg.deleteFile('input.webm').catch(() => undefined);
      await ffmpeg.deleteFile('output.mp4').catch(() => undefined);
      onProgress('encode', 1);
      return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
    } finally {
      ffmpeg.off('log', logHandler);
    }
  } catch (error) {
    if (signal.aborted) throw new ExportCancelled();
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Export complet selon les réglages. */
export async function exportProject(
  project: Project,
  mediaUrls: Record<string, string>,
  settings: ExportSettings,
  onProgress: ProgressHandler,
  signal: AbortSignal,
): Promise<Blob> {
  const webm = await renderToWebm(project, mediaUrls, settings, onProgress, signal);
  throwIfAborted(signal);
  if (settings.container === 'webm') return webm;
  return convertToMp4(webm, projectDuration(project), settings, onProgress, signal);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
