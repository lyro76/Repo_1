import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '@/lib/i18n';
import { FORMATS } from '@/lib/formats';
import { formatTime } from '@/lib/time';
import { useCaptureStore } from '@/store/captureStore';
import { useProjectStore } from '@/store/projectStore';
import { Button } from '@/app/ui';
import { Icon } from '@/app/Icons';
import { getCaptureEngine } from './engine';
import { pipRect, pointInRect } from './layout';
import { startRecordingFlow, stopRecordingFlow, toggleRecording, togglePause, cancelCountdown } from './actions';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function CaptureStudio({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const settings = useCaptureStore((s) => s.settings);
  const recState = useCaptureStore((s) => s.recState);
  const countdown = useCaptureStore((s) => s.countdown);
  const elapsed = useCaptureStore((s) => s.elapsed);
  const webcamOn = useCaptureStore((s) => s.webcamOn);
  const screenOn = useCaptureStore((s) => s.screenOn);
  const error = useCaptureStore((s) => s.error);
  const projectFormat = useProjectStore((s) => s.project?.format);
  const projectId = useProjectStore((s) => s.project?.id);

  // Le format du studio suit celui du projet à l'ouverture.
  useEffect(() => {
    if (projectFormat) useCaptureStore.getState().update({ format: projectFormat });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const engine = getCaptureEngine();
    const host = hostRef.current;
    if (host && engine.canvas.parentElement !== host) host.appendChild(engine.canvas);
  }, []);

  const recording = recState === 'recording' || recState === 'paused';

  useEffect(() => {
    getCaptureEngine().setVisible(active);
  }, [active]);

  useEffect(() => {
    if (!active && !recording) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        toggleRecording();
      } else if (key === 'p') {
        event.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, recording]);

  const { width, height } = FORMATS[settings.format];
  const canDragPip = settings.layout === 'screenPip' && webcamOn && screenOn;

  const toCanvas = (event: ReactPointerEvent) => {
    const canvas = getCaptureEngine().canvas;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDragPip) return;
    const point = toCanvas(event);
    const { webcamAspect } = useCaptureStore.getState();
    const rect = pipRect(settings.pip, width, height, webcamAspect);
    if (!pointInRect(point.x, point.y, rect)) return;
    dragRef.current = { dx: point.x - (rect.x + rect.width / 2), dy: point.y - (rect.y + rect.height / 2) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toCanvas(event);
    useCaptureStore.getState().updatePip({
      x: Math.min(1, Math.max(0, (point.x - drag.dx) / width)),
      y: Math.min(1, Math.max(0, (point.y - drag.dy) / height)),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          className={`relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ${
            recState === 'recording' ? 'ring-2 ring-red-500' : 'ring-zinc-800'
          } ${canDragPip ? 'cursor-move' : ''}`}
          style={{ aspectRatio: `${width} / ${height}`, height: width < height ? '100%' : undefined, width: width >= height ? '100%' : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={hostRef} className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full" />
          {recState === 'countdown' && countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span key={countdown} className="animate-ping text-8xl font-bold text-white [animation-iteration-count:1] [animation-duration:1s]">
                {countdown}
              </span>
            </div>
          )}
          {recording && (
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium">
              <span className={`h-2 w-2 rounded-full ${recState === 'recording' ? 'animate-pulse bg-red-500' : 'bg-yellow-400'}`} />
              {recState === 'recording' ? t('capture.recording') : t('capture.paused')} · {formatTime(elapsed)}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-200">
          <Icon name="warning" className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" className="text-red-300 hover:text-white" onClick={() => useCaptureStore.getState().set({ error: null })}>
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-zinc-800 bg-zinc-900/60 px-4 py-3">
        {recState === 'idle' && (
          <Button variant="record" icon="record" onClick={() => startRecordingFlow()} title="R">
            {t('capture.record')}
          </Button>
        )}
        {recState === 'countdown' && (
          <Button onClick={() => cancelCountdown()} icon="close">
            {t('common.cancel')} ({countdown})
          </Button>
        )}
        {recording && (
          <>
            <Button icon={recState === 'paused' ? 'play' : 'pause'} onClick={() => togglePause()} title="P">
              {recState === 'paused' ? t('capture.resume') : t('capture.pause')}
            </Button>
            <Button variant="danger" icon="stop" onClick={() => void stopRecordingFlow()} title="R">
              {t('capture.stop')}
            </Button>
            <span className="min-w-16 font-mono text-sm tabular-nums text-zinc-300">{formatTime(elapsed)}</span>
          </>
        )}
        {recState === 'finalizing' && <span className="text-sm text-zinc-400">{t('capture.saving')}</span>}
        <span className="ml-4 hidden text-[11px] text-zinc-500 md:inline">{t('capture.shortcuts')}</span>
      </div>
    </div>
  );
}
