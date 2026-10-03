import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { getTextProps } from '@/lib/text';
import { t } from '@/lib/i18n';
import { isClipActiveAt } from '@/lib/timeline/clips';
import { updateClip } from '@/lib/timeline/ops';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';

/**
 * Poignée de déplacement du texte sélectionné, posée sur l'aperçu :
 * on fait glisser le texte directement sur l'image.
 */
export function TextOverlayEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);
  const selectedId = usePlaybackStore((s) => s.selectedClipId);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const playing = usePlaybackStore((s) => s.playing);
  const clip = selectedId ? project?.clips[selectedId] : undefined;

  if (!clip || clip.type !== 'text' || playing || !isClipActiveAt(clip, currentTime)) {
    return <div ref={containerRef} className="pointer-events-none absolute inset-0" />;
  }
  const props = getTextProps(clip);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const store = useProjectStore.getState();
    store.beginTransaction();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: props.x, y: props.y };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const x = Math.min(1, Math.max(0, origin.x + (e.clientX - startX) / box.width));
      const y = Math.min(1, Math.max(0, origin.y + (e.clientY - startY) / box.height));
      store.updateTransient((p) => updateClip(p, clip.id, { props: { ...p.clips[clip.id]?.props, x, y } }));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      useProjectStore.getState().endTransaction();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      <div
        onPointerDown={onPointerDown}
        className="pointer-events-auto absolute h-10 w-40 -translate-x-1/2 -translate-y-1/2 cursor-move rounded border-2 border-dashed border-violet-400/90 bg-violet-500/10"
        style={{ left: `${props.x * 100}%`, top: `${props.y * 100}%` }}
        title={t('preview.dragText')}
      />
    </div>
  );
}
