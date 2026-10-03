import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { FORMATS } from '@/lib/formats';
import { projectDuration } from '@/lib/timeline/clips';
import { useProjectStore } from '@/store/projectStore';
import { getPlayer } from './player';
import { TextOverlayEditor } from './TextOverlayEditor';

export function PreviewPanel({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const project = useProjectStore((s) => s.project);

  useEffect(() => {
    const player = getPlayer();
    const host = hostRef.current;
    if (host && player.canvas.parentElement !== host) host.replaceChildren(player.canvas);
    player.requestRender();
  }, []);

  useEffect(() => {
    if (active) getPlayer().requestRender();
  }, [active]);

  if (!project) return null;
  const { width, height } = FORMATS[project.format];
  const empty = projectDuration(project) === 0;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div
        className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-zinc-800"
        style={{ aspectRatio: `${width} / ${height}`, height: width < height ? '100%' : undefined, width: width >= height ? '100%' : undefined }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <TextOverlayEditor />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-zinc-500">{t('preview.empty')}</div>
        )}
      </div>
    </div>
  );
}
