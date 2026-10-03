import { useState } from 'react';
import { t } from '@/lib/i18n';
import { FORMATS } from '@/lib/formats';
import { useProjectStore, selectCanRedo, selectCanUndo } from '@/store/projectStore';
import { useUIStore } from '@/store/uiStore';
import { closeProject } from '@/features/projects/persistence';
import { Button, TextInput } from './ui';
import { Icon } from './Icons';

export function TopBar() {
  const project = useProjectStore((s) => s.project);
  const saveState = useProjectStore((s) => s.saveState);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const setMeta = useProjectStore((s) => s.setMeta);
  const setExportOpen = useUIStore((s) => s.setExportOpen);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  if (!project) return null;

  const saveLabel =
    saveState === 'saving'
      ? t('topbar.saving')
      : saveState === 'error'
        ? t('topbar.saveError')
        : saveState === 'dirty'
          ? t('topbar.unsaved')
          : t('topbar.saved');

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== project.name) setMeta({ name });
    setEditingName(false);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/80 px-3">
      <Button variant="ghost" size="sm" icon="back" onClick={() => void closeProject()}>
        {t('topbar.backToProjects')}
      </Button>
      <div className="h-5 w-px bg-zinc-800" />
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="clapper" className="h-4 w-4 text-violet-400" />
        {editingName ? (
          <TextInput
            autoFocus
            className="h-7 w-56 py-0"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setEditingName(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="truncate text-sm font-medium text-zinc-100 hover:text-white"
            title={t('common.rename')}
            onClick={() => {
              setDraftName(project.name);
              setEditingName(true);
            }}
          >
            {project.name}
          </button>
        )}
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {FORMATS[project.format].label} · {project.fps} ips
        </span>
      </div>
      <span className={`ml-2 hidden text-[11px] sm:inline ${saveState === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>{saveLabel}</span>
      <div className="flex-1" />
      <Button size="icon" variant="ghost" icon="undo" title={t('topbar.undo')} aria-label={t('topbar.undo')} disabled={!canUndo} onClick={() => undo()} />
      <Button size="icon" variant="ghost" icon="redo" title={t('topbar.redo')} aria-label={t('topbar.redo')} disabled={!canRedo} onClick={() => redo()} />
      <Button size="icon" variant="ghost" icon="keyboard" title={t('topbar.shortcuts')} aria-label={t('topbar.shortcuts')} onClick={() => setShortcutsOpen(true)} />
      <Button variant="primary" size="sm" icon="export" onClick={() => setExportOpen(true)}>
        {t('topbar.export')}
      </Button>
    </header>
  );
}
