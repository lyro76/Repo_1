import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { rulerStep, formatTime } from '@/lib/time';
import { usePlaybackStore } from '@/store/playbackStore';
import { RULER_HEIGHT } from './timelineUi';

function label(time: number, step: number): string {
  if (step >= 1) return formatTime(time);
  return `${formatTime(time)}.${Math.round((time % 1) * 10)}`;
}

export function Ruler({ width, viewportWidth, onSeekStart }: { width: number; viewportWidth: number; onSeekStart: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  const zoom = usePlaybackStore((s) => s.zoom);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const currentTime = usePlaybackStore((s) => s.currentTime);

  const ticks = useMemo(() => {
    const step = rulerStep(zoom);
    const minor = step / 5;
    const start = Math.max(0, Math.floor(scrollLeft / zoom / step) * step - step);
    const end = (scrollLeft + viewportWidth) / zoom + step;
    const out: { time: number; major: boolean }[] = [];
    for (let time = start; time <= end; time += minor) {
      const rounded = Math.round(time * 1000) / 1000;
      const major = Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6;
      out.push({ time: rounded, major });
    }
    return { list: out, step };
  }, [zoom, scrollLeft, viewportWidth]);

  return (
    <div
      className="no-select relative cursor-pointer border-b border-zinc-800 bg-zinc-900"
      style={{ width, height: RULER_HEIGHT }}
      onPointerDown={onSeekStart}
    >
      {ticks.list.map(({ time, major }) => (
        <div key={time} className="absolute bottom-0" style={{ left: time * zoom }}>
          <div className={`w-px ${major ? 'h-3 bg-zinc-500' : 'h-1.5 bg-zinc-700'}`} />
          {major && (
            <span className="absolute -top-[15px] left-1 whitespace-nowrap font-mono text-[10px] text-zinc-500">{label(time, ticks.step)}</span>
          )}
        </div>
      ))}
      <div className="pointer-events-none absolute top-0 h-full" style={{ left: currentTime * zoom }}>
        <div className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-sm bg-red-500" />
        <div className="absolute left-0 top-0 h-full w-px bg-red-500" />
      </div>
    </div>
  );
}
