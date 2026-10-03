import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { getCaptureEngine } from './engine';

/** Vumètre du micro, mis à jour à chaque image sans re-rendu React. */
export function MicMeter({ muted }: { muted: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const level = getCaptureEngine().getMicLevel();
      smoothed = Math.max(level, smoothed * 0.9);
      if (barRef.current) {
        barRef.current.style.width = `${Math.round(smoothed * 100)}%`;
        barRef.current.style.backgroundColor = smoothed > 0.85 ? '#ef4444' : smoothed > 0.6 ? '#eab308' : '#22c55e';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="flex items-center gap-2" title={t('capture.micLevel')}>
      <div className={`h-2 flex-1 overflow-hidden rounded-full bg-zinc-800 ${muted ? 'opacity-40' : ''}`}>
        <div ref={barRef} className="h-full w-0 rounded-full transition-[width] duration-75" />
      </div>
    </div>
  );
}
