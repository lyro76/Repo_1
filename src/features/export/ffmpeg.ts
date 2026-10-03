import { FFmpeg } from '@ffmpeg/ffmpeg';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
}

/** Charge ffmpeg.wasm une seule fois (cœur servi depuis /ffmpeg, même origine). */
export function loadFfmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return Promise.resolve(instance);
  if (!loading) {
    const ffmpeg = new FFmpeg();
    loading = ffmpeg
      .load({ coreURL: assetUrl('ffmpeg/ffmpeg-core.js'), wasmURL: assetUrl('ffmpeg/ffmpeg-core.wasm') })
      .then(() => {
        instance = ffmpeg;
        return ffmpeg;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Arrête ffmpeg (annulation) : l'instance sera rechargée au prochain export. */
export function terminateFfmpeg() {
  instance?.terminate();
  instance = null;
}
