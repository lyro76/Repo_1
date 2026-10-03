import type { MediaKind } from '@/types';

const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'weba'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

export const ACCEPTED_IMPORT = '.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a,.png,.jpg,.jpeg,.webp,video/mp4,video/webm,audio/mpeg,audio/wav,image/png,image/jpeg';

/** Détermine le type d'un fichier importé (vidéo, audio, image) d'après son type MIME ou son extension. */
export function classifyFile(name: string, mimeType: string): MediaKind | undefined {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return undefined;
}

export const DEFAULT_IMAGE_DURATION = 5;

export type MediaProbe = {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
};

function waitEvent(target: EventTarget, event: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout: ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`error while waiting for ${event}`));
    };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

/** Certains WebM (MediaRecorder) annoncent une durée infinie : on force le calcul en cherchant à la fin. */
async function resolveDuration(el: HTMLMediaElement): Promise<number> {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  el.currentTime = 1e7;
  try {
    await waitEvent(el, 'durationchange', 5000);
  } catch {
    // ignore
  }
  const duration = Number.isFinite(el.duration) ? el.duration : 0;
  el.currentTime = 0;
  return duration;
}

type AudioTrackAware = HTMLVideoElement & {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
};

/** Lit les métadonnées d'un média (durée, dimensions, présence d'audio). */
export async function probeMedia(url: string, kind: MediaKind): Promise<MediaProbe> {
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { duration: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false };
  }
  const el = document.createElement(kind === 'video' ? 'video' : 'audio');
  el.preload = 'metadata';
  el.muted = true;
  el.src = url;
  await waitEvent(el, 'loadedmetadata');
  const duration = await resolveDuration(el);
  if (kind === 'audio') {
    el.removeAttribute('src');
    el.load();
    return { duration, hasAudio: true };
  }
  const video = el as AudioTrackAware;
  const hasAudio = video.audioTracks ? video.audioTracks.length > 0 : video.mozHasAudio ?? true;
  const result: MediaProbe = { duration, width: video.videoWidth, height: video.videoHeight, hasAudio };
  video.removeAttribute('src');
  video.load();
  return result;
}

/** Choisit le meilleur type MIME pris en charge par MediaRecorder. */
export function pickRecorderMimeType(candidates: string[]): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export const VIDEO_RECORDER_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
];
