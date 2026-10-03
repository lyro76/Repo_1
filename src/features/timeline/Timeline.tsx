import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { TrackType } from '@/types';
import { t } from '@/lib/i18n';
import { newId } from '@/lib/ids';
import { orderedTracks, projectDuration, trackClips } from '@/lib/timeline/clips';
import { addTrack } from '@/lib/timeline/ops';
import { wheelZoomFactor } from '@/lib/timeline/view';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';
import { Icon } from '@/app/Icons';
import { ClipView } from './ClipView';
import { Ruler } from './Ruler';
import { TrackHeader } from './TrackHeader';
import { HEADER_WIDTH, LANE_HEIGHT, RULER_HEIGHT, useTimelineUi, zoomTo } from './timelineUi';
import { ensureAnalysis } from './mediaAnalysis';

const TAIL_SECONDS = 30;

function AddTrackMenu() {
  const [open, setOpen] = useState(false);
  const commit = useProjectStore((s) => s.commit);
  const notify = useUIStore((s) => s.notify);
  const add = (type: TrackType) => {
    setOpen(false);
    commit((p) => {
      const count = p.tracks.filter((tr) => tr.type === type).length + 1;
      return addTrack(p, type, newId('track'), `${t(`timeline.track.${type}`)} ${count}`);
    });
    notify(t('toast.trackAdded'));
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-white"
      >
        <Icon name="plus" className="h-3 w-3" />
        {t('timeline.addTrack')}
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-40 w-40 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {(['video', 'audio', 'text'] as TrackType[]).map((type) => (
            <button key={type} type="button" onClick={() => add(type)} className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800">
              {t(`timeline.addTrack.${type}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);
  const media = useProjectStore((s) => s.media);
  const mediaUrls = useProjectStore((s) => s.mediaUrls);
  const zoom = usePlaybackStore((s) => s.zoom);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const selectedClipId = usePlaybackStore((s) => s.selectedClipId);
  const viewportWidth = useTimelineUi((s) => s.viewportWidth);
  const snapLine = useTimelineUi((s) => s.snapLine);

  // Analyse des médias (miniatures, formes d'onde).
  useEffect(() => {
    for (const asset of Object.values(media)) ensureAnalysis(asset, mediaUrls[asset.id]);
  }, [media, mediaUrls]);

  // Largeur visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => useTimelineUi.getState().setViewportWidth(Math.max(100, el.clientWidth - HEADER_WIDTH)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Défilement piloté par le store (zoom, suivi de la tête de lecture).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && Math.abs(el.scrollLeft - scrollLeft) > 1) el.scrollLeft = scrollLeft;
  }, [scrollLeft, zoom]);

  // Ctrl + molette : zoom centré sur le pointeur.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = Math.max(0, event.clientX - rect.left - HEADER_WIDTH);
      zoomTo(usePlaybackStore.getState().zoom * wheelZoomFactor(event.deltaY), anchor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Suivi de la tête de lecture pendant la lecture.
  useEffect(
    () =>
      usePlaybackStore.subscribe((state) => {
        if (!state.playing) return;
        const x = state.currentTime * state.zoom;
        const width = useTimelineUi.getState().viewportWidth;
        if (x > state.scrollLeft + width - 40 || x < state.scrollLeft) state.setScrollLeft(Math.max(0, x - 40));
      }),
    [],
  );

  if (!project) return null;

  const duration = projectDuration(project);
  const contentWidth = Math.max((duration + TAIL_SECONDS) * zoom, viewportWidth);
  const tracks = orderedTracks(project);
  const viewFrom = scrollLeft;
  const viewTo = scrollLeft + viewportWidth;

  const timeFromClientX = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_WIDTH + el.scrollLeft) / zoom);
  };

  const startScrub = (event: ReactPointerEvent<HTMLDivElement>, deselect: boolean) => {
    if (event.button !== 0) return;
    const playback = usePlaybackStore.getState();
    if (deselect) playback.select(null);
    playback.setCurrentTime(timeFromClientX(event.clientX));
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => usePlaybackStore.getState().setCurrentTime(timeFromClientX(e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const totalHeight = RULER_HEIGHT + tracks.reduce((sum, tr) => sum + LANE_HEIGHT[tr.type], 0);

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-auto bg-zinc-950/60"
      onScroll={(e) => usePlaybackStore.getState().setScrollLeft(e.currentTarget.scrollLeft)}
    >
      <div className="relative" style={{ width: HEADER_WIDTH + contentWidth, minHeight: totalHeight }}>
        {/* Règle */}
        <div className="sticky top-0 z-30 flex">
          <div
            className="sticky left-0 z-40 flex shrink-0 items-center border-b border-r border-zinc-800 bg-zinc-900 px-2"
            style={{ width: HEADER_WIDTH, height: RULER_HEIGHT }}
          >
            <AddTrackMenu />
          </div>
          <Ruler width={contentWidth} viewportWidth={viewportWidth} onSeekStart={(e) => startScrub(e, false)} />
        </div>

        {/* Pistes */}
        {tracks.map((track) => (
          <div key={track.id} className="flex">
            <TrackHeader project={project} track={track} />
            <div
              data-track-id={track.id}
              className={`relative border-b border-zinc-800/80 ${track.muted ? 'bg-zinc-900/20' : 'bg-zinc-900/40'}`}
              style={{ width: contentWidth, height: LANE_HEIGHT[track.type] }}
              onPointerDown={(e) => startScrub(e, true)}
            >
              {trackClips(project, track.id).map((clip) => (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  zoom={zoom}
                  height={LANE_HEIGHT[track.type]}
                  selected={clip.id === selectedClipId}
                  viewFrom={viewFrom}
                  viewTo={viewTo}
                />
              ))}
            </div>
          </div>
        ))}

        {duration === 0 && (
          <div className="pointer-events-none absolute text-xs text-zinc-500" style={{ left: HEADER_WIDTH + 16, top: RULER_HEIGHT + 70 }}>
            {t('timeline.empty')}
          </div>
        )}

        {/* Ligne d'aimantation (sous les en-têtes de pistes, au-dessus des clips) */}
        {snapLine !== null && (
          <div
            className="pointer-events-none absolute top-0 z-[15] w-px bg-yellow-300"
            style={{ left: HEADER_WIDTH + snapLine * zoom, height: totalHeight }}
          />
        )}

        {/* Ligne de la tête de lecture (la poignée est dans la règle) */}
        <div
          className="pointer-events-none absolute top-0 z-[15] w-px bg-red-500"
          style={{ left: HEADER_WIDTH + currentTime * zoom, height: totalHeight }}
        />
      </div>
    </div>
  );
}
