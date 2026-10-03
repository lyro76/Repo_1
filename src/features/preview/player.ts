import { t } from '@/lib/i18n';
import { FORMATS } from '@/lib/formats';
import { projectDuration } from '@/lib/timeline/clips';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { MediaPool } from './mediaPool';
import { renderFrame } from './renderFrame';

/** L'aperçu est rendu à mi-résolution pour rester fluide. */
const PREVIEW_SCALE = 0.5;

/**
 * Lecteur de l'aperçu : horloge, synchronisation des médias et rendu canvas.
 * L'état (lecture, temps courant) vit dans `usePlaybackStore`.
 */
class Player {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audioCtx: AudioContext;
  private master: GainNode;
  private pool: MediaPool;
  private raf = 0;
  private clockStart = 0;
  private timeAtStart = 0;
  /** Dernier temps écrit par le lecteur lui-même (pour détecter les sauts externes). */
  private ownTime = -1;
  private renderQueued = false;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'h-full w-full';
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error(t('error.canvas'));
    this.ctx = ctx;
    this.audioCtx = new AudioContext();
    this.master = this.audioCtx.createGain();
    this.master.connect(this.audioCtx.destination);
    this.pool = new MediaPool(this.audioCtx, this.master, (id) => useProjectStore.getState().mediaUrls[id]);
    this.pool.onFrameReady = () => this.requestRender();

    this.unsubscribers.push(
      usePlaybackStore.subscribe((state, prev) => {
        if (state.playing !== prev.playing) {
          if (state.playing) this.start();
          else this.stop();
        }
        if (state.currentTime !== prev.currentTime && state.currentTime !== this.ownTime) {
          // Saut de la tête de lecture depuis l'interface.
          this.timeAtStart = state.currentTime;
          this.clockStart = performance.now();
          this.syncAndRender(state.currentTime, true);
        }
      }),
      useProjectStore.subscribe((state, prev) => {
        if (state.project !== prev.project || state.mediaUrls !== prev.mediaUrls) this.requestRender();
      }),
    );
  }

  private resize() {
    const project = useProjectStore.getState().project;
    if (!project) return;
    const { width, height } = FORMATS[project.format];
    const w = Math.round(width * PREVIEW_SCALE);
    const h = Math.round(height * PREVIEW_SCALE);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  requestRender() {
    if (this.renderQueued || usePlaybackStore.getState().playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.syncAndRender(usePlaybackStore.getState().currentTime, false);
    });
  }

  private syncAndRender(time: number, force: boolean) {
    const project = useProjectStore.getState().project;
    if (!project) return;
    this.resize();
    this.pool.sync(project, time, usePlaybackStore.getState().playing, force);
    renderFrame(this.ctx, project, time, this.pool);
  }

  private start() {
    const project = useProjectStore.getState().project;
    if (!project) return;
    const duration = projectDuration(project);
    let time = usePlaybackStore.getState().currentTime;
    if (duration <= 0) {
      usePlaybackStore.getState().pause();
      return;
    }
    if (time >= duration - 0.01) {
      time = 0;
      this.setTime(0);
    }
    void this.audioCtx.resume();
    this.timeAtStart = time;
    this.clockStart = performance.now();
    this.syncAndRender(time, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.pool.pauseAll();
    this.requestRender();
  }

  private setTime(time: number) {
    this.ownTime = time;
    usePlaybackStore.getState().setCurrentTime(time);
  }

  private tick = () => {
    const playback = usePlaybackStore.getState();
    const project = useProjectStore.getState().project;
    if (!playback.playing || !project) return;
    const duration = projectDuration(project);
    const time = this.timeAtStart + (performance.now() - this.clockStart) / 1000;
    if (time >= duration) {
      this.setTime(duration);
      playback.pause();
      return;
    }
    this.setTime(time);
    this.resize();
    this.pool.sync(project, time, true);
    renderFrame(this.ctx, project, time, this.pool);
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsubscribers.forEach((fn) => fn());
    this.pool.dispose();
    void this.audioCtx.close();
  }
}

let player: Player | null = null;

export function getPlayer(): Player {
  if (!player) player = new Player();
  return player;
}

export function disposePlayer() {
  player?.dispose();
  player = null;
}
