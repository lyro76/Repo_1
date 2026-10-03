import { useRef, useState, type DragEvent } from 'react';
import type { MediaAsset } from '@/types';
import { t } from '@/lib/i18n';
import { ACCEPTED_IMPORT, MEDIA_DRAG_TYPE } from '@/lib/media';
import { formatBytes, formatTime } from '@/lib/time';
import { useProjectStore } from '@/store/projectStore';
import { useAnalysisStore } from '@/store/analysisStore';
import { useUIStore } from '@/store/uiStore';
import { Button, Dialog } from '@/app/ui';
import { Icon } from '@/app/Icons';
import { addMediaClip, deleteMedia, importFiles } from './actions';

function MediaItem({ asset, onDelete }: { asset: MediaAsset; onDelete: () => void }) {
  const thumb = useAnalysisStore((s) => s.thumbnails[asset.id]?.urls[0]);
  const notify = useUIStore((s) => s.notify);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group flex cursor-grab items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 hover:border-zinc-600"
    >
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-800 bg-cover bg-center" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        {!thumb && <Icon name={asset.kind === 'audio' ? 'music' : asset.kind === 'image' ? 'image' : 'video'} className="h-5 w-5 text-zinc-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-zinc-200" title={asset.name}>
          {asset.name}
        </p>
        <p className="text-[11px] text-zinc-500">
          {t(`media.kind.${asset.kind}`)}
          {asset.kind !== 'image' && ` · ${formatTime(asset.duration)}`} · {formatBytes(asset.size)}
        </p>
      </div>
      <div className="flex flex-col gap-1 opacity-60 transition group-hover:opacity-100">
        <Button
          size="icon"
          variant="ghost"
          icon="plus"
          className="h-6 w-6"
          title={t('media.addToTimeline')}
          aria-label={t('media.addToTimeline')}
          onClick={() => {
            if (addMediaClip(asset)) notify(t('toast.mediaAdded'));
          }}
        />
        <Button size="icon" variant="ghost" icon="trash" className="h-6 w-6" title={t('common.delete')} aria-label={t('common.delete')} onClick={onDelete} />
      </div>
    </li>
  );
}

export function MediaPanel() {
  const media = useProjectStore((s) => s.media);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toDelete, setToDelete] = useState<MediaAsset | null>(null);
  const list = Object.values(media).sort((a, b) => b.createdAt - a.createdAt);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) void importFiles(event.dataTransfer.files);
  };

  return (
    <div
      className={`min-h-full space-y-3 p-4 ${dragOver ? 'bg-violet-500/5 outline-2 -outline-offset-4 outline-dashed outline-violet-500/60' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between">
        <h3 className="panel-title">{t('media.title')}</h3>
        <Button size="sm" variant="primary" icon="upload" onClick={() => inputRef.current?.click()}>
          {t('media.import')}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMPORT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="text-[11px] text-zinc-500">{t('media.importHint')}</p>
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">{t('media.empty')}</div>
      ) : (
        <>
          <p className="text-[11px] text-zinc-500">{t('media.dragHint')}</p>
          <ul className="space-y-2">
            {list.map((asset) => (
              <MediaItem key={asset.id} asset={asset} onDelete={() => setToDelete(asset)} />
            ))}
          </ul>
        </>
      )}
      {toDelete && (
        <Dialog title={t('common.delete')} onClose={() => setToDelete(null)}>
          <p className="text-sm text-zinc-300">{t('media.deleteConfirm')}</p>
          <p className="mt-2 truncate text-xs text-zinc-500">{toDelete.name}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setToDelete(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                void deleteMedia(toDelete.id);
                setToDelete(null);
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
