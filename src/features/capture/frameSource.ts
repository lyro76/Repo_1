// Source d'images pour le compositeur. Utilise MediaStreamTrackProcessor quand
// il est disponible (fonctionne même onglet masqué), sinon un <video> caché.

type ProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

function getProcessorCtor(): ProcessorCtor | undefined {
  const ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor }).MediaStreamTrackProcessor;
  return typeof ctor === 'function' ? ctor : undefined;
}

export class FrameSource {
  private latest: VideoFrame | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private video: HTMLVideoElement | null = null;
  private disposed = false;

  constructor(readonly track: MediaStreamTrack) {
    const Processor = getProcessorCtor();
    if (Processor) {
      try {
        const processor = new Processor({ track });
        this.reader = processor.readable.getReader();
        void this.pump();
        return;
      } catch {
        this.reader = null;
      }
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => undefined);
    this.video = video;
  }

  private async pump() {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.disposed) {
          value?.close();
          break;
        }
        this.latest?.close();
        this.latest = value;
      }
    } catch {
      // piste arrêtée
    }
  }

  /** Image courante et ses dimensions, ou null si rien n'est encore disponible. */
  current(): { image: CanvasImageSource; width: number; height: number } | null {
    if (this.latest) {
      return { image: this.latest, width: this.latest.displayWidth, height: this.latest.displayHeight };
    }
    const video = this.video;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      return { image: video, width: video.videoWidth, height: video.videoHeight };
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    void this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    this.latest?.close();
    this.latest = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
