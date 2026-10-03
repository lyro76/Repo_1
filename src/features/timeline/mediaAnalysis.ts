import type { MediaAsset } from '@/types';
import { computePeaks } from '@/lib/timeline/view';
import { useAnalysisStore } from '@/store/analysisStore';

export const PEAKS_PER_SECOND = 50;
const THUMB_HEIGHT = 72;
const MAX_THUMBS = 60;

const pending = new Set<string>();

function waitFor(el: HTMLMediaElement, event: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener(event, done);
      el.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    el.addEventListener(event, done, { once: true });
    el.addEventListener('error', done, { once: true });
  });
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', 0.6)), 'image/jpeg', 0.65);
  });
}

async function generateVideoThumbnails(asset: MediaAsset, url: string) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await waitFor(video, 'loadeddata');
  const width = video.videoWidth || asset.width || 16;
  const height = video.videoHeight || asset.height || 9;
  const aspect = width / height;
  const canvas = document.createElement('canvas');
  canvas.height = THUMB_HEIGHT;
  canvas.width = Math.max(1, Math.round(THUMB_HEIGHT * aspect));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const duration = asset.duration > 0 ? asset.duration : 1;
  const count = Math.max(1, Math.min(MAX_THUMBS, Math.ceil(duration)));
  const interval = duration / count;
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    video.currentTime = Math.min(duration - 0.05, i * interval + interval / 2);
    await waitFor(video, 'seeked');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    urls.push(await canvasToUrl(canvas));
    // Affichage progressif : quelques miniatures suffisent pour commencer.
    if (i === 0 || i === count - 1 || i % 10 === 9) {
      useAnalysisStore.getState().setThumbnails(asset.id, { interval, urls: [...urls], aspect });
    }
  }
  video.removeAttribute('src');
  video.load();
}

async function generatePeaks(asset: MediaAsset, url: string) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  try {
    const audio = await ctx.decodeAudioData(buffer);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    useAnalysisStore.getState().setPeaks(asset.id, computePeaks(channels, audio.sampleRate, PEAKS_PER_SECOND));
  } catch {
    useAnalysisStore.getState().setPeaks(asset.id, new Float32Array(0));
  }
}

/** Lance (une seule fois) l'analyse d'un média : miniatures et/ou forme d'onde. */
export function ensureAnalysis(asset: MediaAsset, url: string | undefined) {
  if (!url || pending.has(asset.id)) return;
  pending.add(asset.id);
  const store = useAnalysisStore.getState();
  if (asset.kind === 'image') {
    store.setThumbnails(asset.id, { interval: 1, urls: [url], aspect: (asset.width ?? 1) / (asset.height ?? 1) });
    return;
  }
  const jobs: Promise<void>[] = [];
  if (asset.kind === 'video' && !store.thumbnails[asset.id]) jobs.push(generateVideoThumbnails(asset, url));
  if (asset.hasAudio && !store.peaks[asset.id]) jobs.push(generatePeaks(asset, url));
  void Promise.allSettled(jobs);
}

export function resetAnalysis() {
  pending.clear();
  useAnalysisStore.getState().clear();
}
