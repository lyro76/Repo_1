import type { Project, Track } from '@/types';
import { t } from '@/lib/i18n';
import { removeTrack, setTrackMuted } from '@/lib/timeline/ops';
import { useProjectStore } from '@/store/projectStore';
import { Icon, type IconName } from '@/app/Icons';
import { HEADER_WIDTH, LANE_HEIGHT } from './timelineUi';

const ICONS: Record<Track['type'], IconName> = { video: 'video', audio: 'music', text: 'text' };

export function TrackHeader({ project, track }: { project: Project; track: Track }) {
  const commit = useProjectStore((s) => s.commit);
  const sameType = project.tracks.filter((tr) => tr.type === track.type).length;
  return (
    <div
      className="group sticky left-0 z-20 flex shrink-0 items-center gap-2 border-b border-r border-zinc-800 bg-zinc-900 px-2"
      style={{ width: HEADER_WIDTH, height: LANE_HEIGHT[track.type] }}
    >
      <Icon name={ICONS[track.type]} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <span className="flex-1 truncate text-xs text-zinc-300">{track.name}</span>
      {track.type !== 'text' && (
        <button
          type="button"
          className={`rounded p-1 ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-200'}`}
          title={track.muted ? t('timeline.unmuteTrack') : t('timeline.muteTrack')}
          aria-label={track.muted ? t('timeline.unmuteTrack') : t('timeline.muteTrack')}
          onClick={() => commit((p) => setTrackMuted(p, track.id, !track.muted))}
        >
          <Icon name={track.muted ? 'volumeOff' : 'volume'} className="h-3.5 w-3.5" />
        </button>
      )}
      {sameType > 1 && (
        <button
          type="button"
          className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
          title={t('timeline.removeTrack')}
          aria-label={t('timeline.removeTrack')}
          onClick={() => commit((p) => removeTrack(p, track.id))}
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
