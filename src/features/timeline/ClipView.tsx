import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Clip } from '@/types';
import { t } from '@/lib/i18n';
import { getTextProps } from '@/lib/text';
import { clipEnd, findTrack, trackTypeForClip } from '@/lib/timeline/clips';
import { moveClip, trimClip, type TrimEdge } from '@/lib/timeline/ops';
import { collectSnapPoints, snapClipStart, snapTime } from '@/lib/timeline/snap';
import { snapThreshold } from '@/lib/timeline/view';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';
import { Icon } from '@/app/Icons';
import { Filmstrip, Waveform } from './ClipVisuals';
import { useTimelineUi } from './timelineUi';

const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 3;

const COLORS: Record<Clip['type'], { body: string; ring: string; wave: string }> = {
  video: { body: 'bg-indigo-600/70 border-indigo-400/60', ring: 'ring-indigo-200', wave: 'rgba(224,231,255,0.75)' },
  image: { body: 'bg-sky-600/70 border-sky-400/60', ring: 'ring-sky-200', wave: 'rgba(224,242,254,0.75)' },
  audio: { body: 'bg-emerald-700/70 border-emerald-400/60', ring: 'ring-emerald-200', wave: 'rgba(209,250,229,0.9)' },
  text: { body: 'bg-amber-600/80 border-amber-300/60', ring: 'ring-amber-100', wave: '' },
};

function trackUnderPointer(clientX: number, clientY: number): string | undefined {
  const el = document.elementFromPoint(clientX, clientY);
  const lane = el instanceof Element ? el.closest('[data-track-id]') : null;
  return lane?.getAttribute('data-track-id') ?? undefined;
}

type Props = {
  clip: Clip;
  zoom: number;
  height: number;
  selected: boolean;
  /** Partie visible de la timeline, en px (repère timeline). */
  viewFrom: number;
  viewTo: number;
};

function ClipViewImpl({ clip, zoom, height, selected, viewFrom, viewTo }: Props) {
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const colors = COLORS[clip.type];
  const media = useProjectStore((s) => (clip.mediaId ? s.media[clip.mediaId] : undefined));
  const span = { from: Math.max(0, viewFrom - left - 200), to: Math.min(width, viewTo - left + 200) };
  const visible = span.to > span.from;

  const label = clip.type === 'text' ? getTextProps(clip).text : clip.name ?? media?.name ?? '';

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, mode: 'move' | TrimEdge) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const store = useProjectStore.getState();
    const playback = usePlaybackStore.getState();
    playback.select(clip.id);
    useUIStore.getState().setRightTab('properties');
    store.beginTransaction();
    const base = useProjectStore.getState().transactionBase ?? store.project;
    if (!base) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let moved = false;
    const threshold = snapThreshold(SNAP_PX, zoom);
    const points = collectSnapPoints(base, { excludeClipIds: [clip.id], playhead: playback.currentTime });
    const mediaDuration = media?.duration;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const snapOn = usePlaybackStore.getState().snapEnabled && !e.altKey;
      const ui = useTimelineUi.getState();
      if (mode === 'move') {
        let desired = clip.start + dx / zoom;
        let snapLine: number | null = null;
        if (snapOn) {
          const result = snapClipStart(desired, clip.duration, points, threshold);
          desired = result.time;
          snapLine = result.snapped ? result.point ?? null : null;
        }
        const hovered = trackUnderPointer(e.clientX, e.clientY);
        const hoveredTrack = hovered ? findTrack(base, hovered) : undefined;
        const targetTrackId = hoveredTrack && hoveredTrack.type === trackTypeForClip(clip.type) ? hoveredTrack.id : clip.trackId;
        ui.setSnapLine(snapLine);
        store.updateTransient(() => moveClip(base, clip.id, desired, targetTrackId));
      } else {
        const edgeTime = mode === 'start' ? clip.start : clipEnd(clip);
        let time = edgeTime + dx / zoom;
        let snapLine: number | null = null;
        if (snapOn) {
          const result = snapTime(time, points, threshold);
          time = result.time;
          snapLine = result.snapped ? result.time : null;
        }
        ui.setSnapLine(snapLine);
        store.updateTransient(() => trimClip(base, clip.id, mode, time, mediaDuration));
      }
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      useTimelineUi.getState().setSnapLine(null);
      useProjectStore.getState().endTransaction();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const showWaveStrip = clip.type === 'video' && media?.hasAudio;
  const bodyHeight = height - 2;

  return (
    <div
      data-clip-id={clip.id}
      className={`group absolute top-px overflow-hidden rounded-md border text-[11px] text-white shadow-sm ${colors.body} ${
        selected ? `z-10 ring-2 ${colors.ring}` : ''
      } ${clip.muted ? 'opacity-80' : ''}`}
      style={{ left, width, height: bodyHeight }}
      onPointerDown={(e) => startDrag(e, 'move')}
    >
      {visible && (clip.type === 'video' || clip.type === 'image') && (
        <Filmstrip clip={clip} zoom={zoom} height={bodyHeight} span={span} />
      )}
      {visible && clip.type === 'audio' && <Waveform clip={clip} zoom={zoom} height={bodyHeight - 14} span={span} color={colors.wave} className="top-3.5" />}
      {visible && showWaveStrip && (
        <Waveform clip={clip} zoom={zoom} height={14} span={span} color={colors.wave} className="bottom-0 bg-black/30" />
      )}

      <div className="pointer-events-none relative flex items-center gap-1 truncate px-2 pt-0.5 font-medium drop-shadow">
        {clip.type === 'text' && <Icon name="text" className="h-3 w-3 shrink-0" />}
        {clip.type === 'audio' && <Icon name="music" className="h-3 w-3 shrink-0" />}
        {clip.muted && <Icon name="volumeOff" className="h-3 w-3 shrink-0" />}
        <span className="truncate">{label}</span>
        {clip.speed !== 1 && <span className="rounded bg-black/40 px-1 text-[10px]">{clip.speed}x</span>}
      </div>

      {clip.transitionIn && clip.transitionIn.type !== 'none' && (
        <div
          className="pointer-events-none absolute left-0 top-0 h-full bg-gradient-to-r from-black/60 to-transparent"
          style={{ width: Math.min(width / 2, clip.transitionIn.duration * zoom) }}
          title={t('timeline.transitionBadge')}
        />
      )}
      {clip.transitionOut && clip.transitionOut.type !== 'none' && (
        <div
          className="pointer-events-none absolute right-0 top-0 h-full bg-gradient-to-l from-black/60 to-transparent"
          style={{ width: Math.min(width / 2, clip.transitionOut.duration * zoom) }}
        />
      )}

      <div
        className={`absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 transition hover:bg-white/40 ${selected ? 'bg-white/25' : ''}`}
        title={t('timeline.trimStart')}
        onPointerDown={(e) => startDrag(e, 'start')}
      />
      <div
        className={`absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 transition hover:bg-white/40 ${selected ? 'bg-white/25' : ''}`}
        title={t('timeline.trimEnd')}
        onPointerDown={(e) => startDrag(e, 'end')}
      />
    </div>
  );
}

export const ClipView = memo(ClipViewImpl);
