import { useRef } from 'react';
import { t } from '@/lib/i18n';
import { ACCEPTED_IMPORT } from '@/lib/media';
import { usePlaybackStore } from '@/store/playbackStore';
import { Button } from '@/app/ui';
import { addTextClip, deleteSelected, duplicateSelected, importFiles, splitAtPlayhead } from './actions';

export function EditTools() {
  const selected = usePlaybackStore((s) => s.selectedClipId);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" icon="scissors" title={t('tools.split')} aria-label={t('tools.split')} onClick={() => splitAtPlayhead()} />
      <Button size="icon" variant="ghost" icon="copy" title={t('tools.duplicate')} aria-label={t('tools.duplicate')} disabled={!selected} onClick={() => duplicateSelected()} />
      <Button size="icon" variant="ghost" icon="trash" title={t('tools.delete')} aria-label={t('tools.delete')} disabled={!selected} onClick={() => deleteSelected()} />
      <div className="mx-1 h-5 w-px bg-zinc-800" />
      <Button size="sm" variant="ghost" icon="text" onClick={() => addTextClip()}>
        {t('tools.addText')}
      </Button>
      <Button size="sm" variant="ghost" icon="upload" onClick={() => inputRef.current?.click()}>
        {t('media.import')}
      </Button>
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
    </div>
  );
}
