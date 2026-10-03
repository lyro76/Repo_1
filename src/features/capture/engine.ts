import fixWebmDuration from 'fix-webm-duration';
import { t } from '@/lib/i18n';
import { createTicker } from '@/lib/ticker';
import { pickRecorderMimeType, VIDEO_RECORDER_TYPES } from '@/lib/media';
import { roundTime } from '@/lib/time';
import { useCaptureStore } from '@/store/captureStore';
import { FrameSource } from './frameSource';
import { composeFrame } from './compositor';
import { recordingElapsed } from './layout';

export type RecordingResult = {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  mimeType: string;
};

const CAPTURE_FPS = 30;

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return t('capture.permissionDenied');
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return t('capture.noDevice');
    if (error.name === 'NotSupportedError') return t('capture.notSupported');
  }
  return error instanceof Error ? error.message : String(error);
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Moteur de capture (singleton) : sources, composition sur canevas,
 * mixage audio et enregistrement MediaRecorder.
 */
class CaptureEngine {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stopTicker: (() => void) | null = null;
  private visible = false;

  private webcamStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private webcamSource: FrameSource | null = null;
  private screenSource: FrameSource | null = null;

  private audioCtx: AudioContext | null = null;
  private mixDestination: MediaStreamAudioDestinationNode | null = null;
  private micGain: GainNode | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private screenAudioNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private segments: { start: number; end?: number }[] = [];
  private elapsedTimer: number | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'h-full w-full object-contain';
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error(t('error.canvas'));
    this.ctx = ctx;
    this.render();
  }

  // ---------- boucle de rendu ----------

  /** Le studio est-il visible ? La boucle tourne si visible ou en enregistrement. */
  setVisible(visible: boolean) {
    this.visible = visible;
    this.updateLoop();
  }

  private isRecording() {
    return this.recorder !== null && this.recorder.state !== 'inactive';
  }

  private updateLoop() {
    const shouldRun = this.visible || this.isRecording();
    if (shouldRun && !this.stopTicker) {
      this.stopTicker = createTicker(CAPTURE_FPS, () => this.render());
    } else if (!shouldRun && this.stopTicker) {
      this.stopTicker();
      this.stopTicker = null;
    }
  }

  private render() {
    const settings = useCaptureStore.getState().settings;
    composeFrame(
      this.ctx,
      { settings, screen: this.screenSource?.current() ?? null, webcam: this.webcamSource?.current() ?? null },
      t('capture.noSource'),
    );
  }

  // ---------- audio ----------

  private ensureAudio(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.mixDestination = this.audioCtx.createMediaStreamDestination();
      this.micGain = this.audioCtx.createGain();
      this.micGain.connect(this.mixDestination);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyserData = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  /** Niveau RMS du micro (0..1) pour le vumètre. */
  getMicLevel(): number {
    if (!this.analyser || !this.analyserData || !this.micNode) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserData);
    let sum = 0;
    for (const v of this.analyserData) sum += v * v;
    const rms = Math.sqrt(sum / this.analyserData.length);
    return Math.min(1, rms * 4);
  }

  // ---------- périphériques ----------

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const toOption = (d: MediaDeviceInfo, i: number) => ({
      deviceId: d.deviceId,
      label: d.label || `${d.kind === 'videoinput' ? t('capture.webcam') : t('capture.mic')} ${i + 1}`,
    });
    useCaptureStore.getState().set({
      videoDevices: devices.filter((d) => d.kind === 'videoinput' && d.deviceId).map(toOption),
      audioDevices: devices.filter((d) => d.kind === 'audioinput' && d.deviceId).map(toOption),
    });
  }

  // ---------- sources ----------

  async enableWebcam(deviceId?: string): Promise<void> {
    const store = useCaptureStore.getState();
    if (!navigator.mediaDevices?.getUserMedia) {
      store.set({ error: t('capture.notSupported') });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: CAPTURE_FPS },
        },
        audio: false,
      });
      this.disableWebcam();
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error(t('capture.noDevice'));
      this.webcamStream = stream;
      this.webcamSource = new FrameSource(track);
      const settings = track.getSettings();
      const aspect = settings.width && settings.height ? settings.width / settings.height : 16 / 9;
      track.addEventListener('ended', () => this.disableWebcam());
      store.set({ webcamOn: true, webcamAspect: aspect, error: null });
      void this.refreshDevices();
    } catch (error) {
      store.set({ error: errorMessage(error) });
    }
  }

  disableWebcam() {
    this.webcamSource?.dispose();
    this.webcamSource = null;
    stopStream(this.webcamStream);
    this.webcamStream = null;
    useCaptureStore.getState().set({ webcamOn: false });
  }

  async startScreenShare(): Promise<void> {
    const store = useCaptureStore.getState();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      store.set({ error: t('capture.notSupported') });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: CAPTURE_FPS }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: store.settings.includeSystemAudio,
      });
      this.stopScreenShare();
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error(t('capture.noDevice'));
      this.screenStream = stream;
      this.screenSource = new FrameSource(track);
      track.addEventListener('ended', () => {
        this.stopScreenShare();
        useCaptureStore.getState().set({ error: t('capture.screenEnded') });
      });
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const ctx = this.ensureAudio();
        this.screenAudioNode = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        if (this.mixDestination) this.screenAudioNode.connect(this.mixDestination);
      }
      store.set({ screenOn: true, error: null });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return; // l'utilisateur a annulé
      store.set({ error: errorMessage(error) });
    }
  }

  stopScreenShare() {
    this.screenSource?.dispose();
    this.screenSource = null;
    this.screenAudioNode?.disconnect();
    this.screenAudioNode = null;
    stopStream(this.screenStream);
    this.screenStream = null;
    useCaptureStore.getState().set({ screenOn: false });
  }

  async enableMic(deviceId?: string): Promise<void> {
    const store = useCaptureStore.getState();
    if (!navigator.mediaDevices?.getUserMedia) {
      store.set({ error: t('capture.notSupported') });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.disableMic();
      this.micStream = stream;
      const ctx = this.ensureAudio();
      this.micNode = ctx.createMediaStreamSource(stream);
      if (this.micGain) this.micNode.connect(this.micGain);
      if (this.analyser) this.micNode.connect(this.analyser);
      if (this.micGain) this.micGain.gain.value = store.micMuted ? 0 : 1;
      store.set({ micOn: true, error: null });
      void this.refreshDevices();
    } catch (error) {
      store.set({ error: errorMessage(error) });
    }
  }

  disableMic() {
    this.micNode?.disconnect();
    this.micNode = null;
    stopStream(this.micStream);
    this.micStream = null;
    useCaptureStore.getState().set({ micOn: false });
  }

  setMicMuted(muted: boolean) {
    if (this.micGain) this.micGain.gain.value = muted ? 0 : 1;
    useCaptureStore.getState().set({ micMuted: muted });
  }

  hasVideoSource(): boolean {
    const { layout } = useCaptureStore.getState().settings;
    if (layout === 'webcamOnly') return this.webcamSource !== null;
    if (layout === 'screenOnly') return this.screenSource !== null;
    return this.webcamSource !== null || this.screenSource !== null;
  }

  // ---------- enregistrement ----------

  startRecording(): boolean {
    if (this.isRecording()) return false;
    const mimeType = pickRecorderMimeType(VIDEO_RECORDER_TYPES);
    if (typeof MediaRecorder === 'undefined' || !mimeType) {
      useCaptureStore.getState().set({ error: t('capture.notSupported') });
      return false;
    }
    this.render();
    const videoStream = this.canvas.captureStream(CAPTURE_FPS);
    const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
    const hasAudio = Boolean(this.micNode || this.screenAudioNode);
    if (hasAudio && this.mixDestination) {
      const audioTrack = this.mixDestination.stream.getAudioTracks()[0];
      if (audioTrack) tracks.push(audioTrack);
    }
    const stream = new MediaStream(tracks);
    const { width, height } = this.canvas;
    const pixels = width * height;
    const recorder = new MediaRecorder(stream, {
      mimeType: hasAudio ? mimeType : mimeType.replace(/,opus/, ''),
      videoBitsPerSecond: pixels >= 1920 * 1080 ? 10_000_000 : 6_000_000,
      audioBitsPerSecond: 160_000,
    });
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder = recorder;
    recorder.start(1000);
    this.segments = [{ start: performance.now() }];
    this.startElapsedTimer();
    this.updateLoop();
    useCaptureStore.getState().set({ recState: 'recording', elapsed: 0 });
    return true;
  }

  pauseRecording() {
    if (this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    const last = this.segments[this.segments.length - 1];
    if (last && last.end === undefined) last.end = performance.now();
    useCaptureStore.getState().set({ recState: 'paused' });
  }

  resumeRecording() {
    if (this.recorder?.state !== 'paused') return;
    this.recorder.resume();
    this.segments.push({ start: performance.now() });
    useCaptureStore.getState().set({ recState: 'recording' });
  }

  private startElapsedTimer() {
    this.stopElapsedTimer();
    this.elapsedTimer = window.setInterval(() => {
      useCaptureStore.getState().set({ elapsed: recordingElapsed(this.segments, performance.now()) / 1000 });
    }, 200);
  }

  private stopElapsedTimer() {
    if (this.elapsedTimer !== null) window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }

  async stopRecording(): Promise<RecordingResult | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') return null;
    useCaptureStore.getState().set({ recState: 'finalizing' });
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    const now = performance.now();
    const last = this.segments[this.segments.length - 1];
    if (last && last.end === undefined) last.end = now;
    const duration = roundTime(recordingElapsed(this.segments, now) / 1000);
    this.stopElapsedTimer();
    recorder.stream.getVideoTracks().forEach((track) => track.stop());
    this.recorder = null;
    this.updateLoop();

    const mimeType = recorder.mimeType || 'video/webm';
    const raw = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    const blob = mimeType.includes('webm') ? await fixWebmDuration(raw, duration * 1000, { logger: false }) : raw;
    const hasAudio = recorder.stream.getAudioTracks().length > 0;
    return { blob, duration, width: this.canvas.width, height: this.canvas.height, hasAudio, mimeType };
  }

  /** Libère toutes les ressources (à la fermeture du projet). */
  dispose() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    this.stopElapsedTimer();
    this.disableWebcam();
    this.stopScreenShare();
    this.disableMic();
    this.visible = false;
    this.updateLoop();
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.mixDestination = null;
    this.micGain = null;
    this.analyser = null;
    this.analyserData = null;
    useCaptureStore.getState().set({ recState: 'idle', elapsed: 0, countdown: 0, error: null });
  }
}

let engine: CaptureEngine | null = null;

export function getCaptureEngine(): CaptureEngine {
  if (!engine) engine = new CaptureEngine();
  return engine;
}

export function disposeCaptureEngine() {
  engine?.dispose();
}
