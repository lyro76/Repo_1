import type { Clip, Project } from '@/types';
import { clipEnd, findTrack, isClipActiveAt, nextClipOnTrack, prevClipOnTrack, sourceTimeAt } from '@/lib/timeline/clips';
import { transitionGainAt } from '@/lib/timeline/transitions';

type Entry = {
  clipId: string;
  mediaId: string;
  el: HTMLMediaElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode | null;
  lastUsed: number;
};

/** Écart toléré entre l'horloge et l'élément avant de forcer un repositionnement. */
const DRIFT_TOLERANCE = 0.25;
/** Préchargement des clips qui commencent bientôt (s). */
const PRELOAD_AHEAD = 1.5;
const MAX_IDLE_MS = 20000;

/**
 * Gère les éléments <video>/<audio> des clips et leur routage audio
 * (élément → gain du clip → sortie). Utilisé par l'aperçu et par l'export.
 */
export class MediaPool {
  private entries = new Map<string, Entry>();
  private images = new Map<string, HTMLImageElement>();
  onFrameReady: (() => void) | null = null;

  constructor(
    private readonly audioCtx: AudioContext,
    private readonly output: AudioNode,
    private readonly resolveUrl: (mediaId: string) => string | undefined,
  ) {}

  private create(clip: Clip): Entry | null {
    if (!clip.mediaId) return null;
    const url = this.resolveUrl(clip.mediaId);
    if (!url) return null;
    const el = document.createElement(clip.type === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.src = url;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    const notify = () => this.onFrameReady?.();
    el.addEventListener('seeked', notify);
    el.addEventListener('loadeddata', notify);
    const gain = this.audioCtx.createGain();
    gain.gain.value = 0;
    gain.connect(this.output);
    let source: MediaElementAudioSourceNode | null = null;
    try {
      source = this.audioCtx.createMediaElementSource(el);
      source.connect(gain);
    } catch {
      el.muted = true;
    }
    const entry: Entry = { clipId: clip.id, mediaId: clip.mediaId, el, gain, source, lastUsed: performance.now() };
    this.entries.set(clip.id, entry);
    return entry;
  }

  private get(clip: Clip): Entry | null {
    const existing = this.entries.get(clip.id);
    if (existing && existing.mediaId === clip.mediaId) {
      existing.lastUsed = performance.now();
      return existing;
    }
    if (existing) this.disposeEntry(existing);
    return this.create(clip);
  }

  private disposeEntry(entry: Entry) {
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
    entry.source?.disconnect();
    entry.gain.disconnect();
    this.entries.delete(entry.clipId);
  }

  /** Élément vidéo d'un clip prêt à être dessiné (ou null). */
  videoFor(clip: Clip): HTMLVideoElement | null {
    const entry = this.entries.get(clip.id);
    const el = entry?.el;
    if (el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0) return el;
    return null;
  }

  imageFor(mediaId: string): HTMLImageElement | null {
    let img = this.images.get(mediaId);
    if (!img) {
      const url = this.resolveUrl(mediaId);
      if (!url) return null;
      img = new Image();
      img.onload = () => this.onFrameReady?.();
      img.src = url;
      this.images.set(mediaId, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Clips qu'il faut garder prêts à l'instant `time` (actifs, voisins de transition, à venir). */
  private wantedClips(project: Project, time: number): Map<string, 'active' | 'hold' | 'preload'> {
    const wanted = new Map<string, 'active' | 'hold' | 'preload'>();
    for (const clip of Object.values(project.clips)) {
      if (!clip.mediaId || (clip.type !== 'video' && clip.type !== 'audio')) continue;
      if (isClipActiveAt(clip, time)) {
        wanted.set(clip.id, 'active');
        if (clip.type === 'video') {
          const inWindow = clip.transitionIn?.type === 'fade' && time < clip.start + clip.transitionIn.duration;
          const outWindow = clip.transitionOut?.type === 'fade' && time > clipEnd(clip) - clip.transitionOut.duration;
          const prev = inWindow ? prevClipOnTrack(project, clip) : undefined;
          const next = outWindow ? nextClipOnTrack(project, clip) : undefined;
          if (prev && !wanted.has(prev.id)) wanted.set(prev.id, 'hold');
          if (next && !wanted.has(next.id)) wanted.set(next.id, 'hold');
        }
      } else if (clip.start > time && clip.start - time <= PRELOAD_AHEAD && !wanted.has(clip.id)) {
        wanted.set(clip.id, 'preload');
      }
    }
    return wanted;
  }

  /**
   * Synchronise lecture, position et volume des éléments avec l'horloge.
   * `force` repositionne tous les éléments actifs (après un saut de la tête de lecture).
   */
  sync(project: Project, time: number, playing: boolean, force = false) {
    const wanted = this.wantedClips(project, time);
    for (const [clipId, role] of wanted) {
      const clip = project.clips[clipId];
      if (!clip) continue;
      const entry = this.get(clip);
      if (!entry) continue;
      const el = entry.el;
      const track = findTrack(project, clip.trackId);
      if (role === 'active') {
        const expected = Math.max(0, sourceTimeAt(clip, time));
        const audible = !clip.muted && !track?.muted;
        entry.gain.gain.value = audible ? clip.volume * transitionGainAt(clip, time) : 0;
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
        if (playing) {
          if (el.paused) {
            if (Math.abs(el.currentTime - expected) > 0.05) el.currentTime = expected;
            void el.play().catch(() => undefined);
          } else if (force || Math.abs(el.currentTime - expected) > DRIFT_TOLERANCE * clip.speed) {
            el.currentTime = expected;
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - expected) > 0.02) el.currentTime = expected;
        }
      } else {
        entry.gain.gain.value = 0;
        if (!el.paused) el.pause();
        if (role === 'preload' && Math.abs(el.currentTime - clip.inPoint) > 0.05) {
          el.currentTime = clip.inPoint;
        } else if (role === 'hold') {
          // Image figée du voisin pendant un fondu enchaîné.
          const held = clip.start > time ? clip.inPoint : Math.max(clip.inPoint, sourceTimeAt(clip, clipEnd(clip) - 0.04));
          if (Math.abs(el.currentTime - held) > 0.05) el.currentTime = held;
        }
      }
    }

    const now = performance.now();
    for (const entry of [...this.entries.values()]) {
      if (wanted.has(entry.clipId)) continue;
      entry.gain.gain.value = 0;
      if (!entry.el.paused) entry.el.pause();
      if (!project.clips[entry.clipId] || now - entry.lastUsed > MAX_IDLE_MS) this.disposeEntry(entry);
    }
  }

  pauseAll() {
    for (const entry of this.entries.values()) {
      entry.gain.gain.value = 0;
      entry.el.pause();
    }
  }

  dispose() {
    for (const entry of [...this.entries.values()]) this.disposeEntry(entry);
    this.images.clear();
  }
}
