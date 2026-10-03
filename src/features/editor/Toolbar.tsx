import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { formatTimecode } from '@/lib/time';
import { projectDuration } from '@/lib/timeline/clips';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { Button } from '@/app/ui';
import { zoomTo, zoomToFit } from '@/features/timeline/timelineUi';
import { togglePlayback } from './playbackActions';
import { EditTools } from './EditTools';

function Divider() {
  return <div className="mx-1 h-5 w-px bg-zinc-800" />;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function Toolbar() {
  const playing = usePlaybackStore((s) => s.playing);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const zoom = usePlaybackStore((s) => s.zoom);
  const snapEnabled = usePlaybackStore((s) => s.snapEnabled);
  const toggleSnap = usePlaybackStore((s) => s.toggleSnap);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const duration = useProjectStore((s) => (s.project ? projectDuration(s.project) : 0));

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
      <EditTools />
      <div className="flex-1" />
      <Group>
        <Button size="icon" variant="ghost" icon="skipBack" title={t('tools.goStart')} aria-label={t('tools.goStart')} onClick={() => setCurrentTime(0)} />
        <Button
          size="icon"
          variant="ghost"
          icon={playing ? 'pause' : 'play'}
          title={playing ? t('tools.pause') : t('tools.play')}
          aria-label={playing ? t('tools.pause') : t('tools.play')}
          onClick={() => togglePlayback()}
        />
        <Button size="icon" variant="ghost" icon="skipForward" title={t('tools.goEnd')} aria-label={t('tools.goEnd')} onClick={() => setCurrentTime(duration)} />
      </Group>
      <span className="min-w-36 text-center font-mono text-xs tabular-nums text-zinc-300">
        {formatTimecode(currentTime)} <span className="text-zinc-600">/ {formatTimecode(duration)}</span>
      </span>
      <div className="flex-1" />
      <Group>
        <Button
          size="icon"
          variant="ghost"
          icon="magnet"
          active={snapEnabled}
          title={t('timeline.snap')}
          aria-label={t('timeline.snap')}
          onClick={() => toggleSnap()}
        />
        <Divider />
        <Button size="icon" variant="ghost" icon="zoomOut" title={t('timeline.zoomOut')} aria-label={t('timeline.zoomOut')} onClick={() => zoomTo(zoom / 1.5)} />
        <Button size="icon" variant="ghost" icon="zoomIn" title={t('timeline.zoomIn')} aria-label={t('timeline.zoomIn')} onClick={() => zoomTo(zoom * 1.5)} />
        <Button size="icon" variant="ghost" icon="fit" title={t('timeline.zoomFit')} aria-label={t('timeline.zoomFit')} onClick={() => zoomToFit()} />
      </Group>
    </div>
  );
}
