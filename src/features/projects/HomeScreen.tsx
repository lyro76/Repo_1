import { useEffect, useState, type FormEvent } from 'react';
import type { Format, ProjectSummary } from '@/types';
import { t } from '@/lib/i18n';
import { FORMATS, FORMAT_LIST } from '@/lib/formats';
import { formatRelativeDate, formatBytes } from '@/lib/time';
import { storageEstimate } from '@/lib/idb';
import { useProjectsStore } from '@/store/projectsStore';
import { useUIStore } from '@/store/uiStore';
import { createAndOpenProject, openProject, refreshProjects, removeProject, renameProject } from './persistence';
import { Icon } from '@/app/Icons';
import { Button, Dialog, TextInput } from '@/app/ui';

export function HomeScreen() {
  const { items, loading } = useProjectsStore();
  const notify = useUIStore((s) => s.notify);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [usage, setUsage] = useState<number | undefined>();

  useEffect(() => {
    void refreshProjects();
    void storageEstimate().then(setUsage);
  }, []);

  const handleOpen = async (id: string) => {
    const ok = await openProject(id);
    if (!ok) notify(t('home.openFailed'), 'error');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-900/60">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600/20 text-violet-300">
            <Icon name="clapper" className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t('app.name')}</h1>
            <p className="text-sm text-zinc-400">{t('app.tagline')}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('home.title')}</h2>
            <p className="text-sm text-zinc-400">{t('home.subtitle')}</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)} icon="plus">
            {t('home.newProject')}
          </Button>
        </div>

        {loading && items.length === 0 ? (
          <p className="text-sm text-zinc-500">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => void handleOpen(project.id)}
                onRename={() => setRenaming(project)}
                onDelete={() => setDeleting(project)}
              />
            ))}
          </ul>
        )}

        {usage !== undefined && (
          <p className="mt-10 text-xs text-zinc-500">{t('home.storageInfo', { used: formatBytes(usage) })}</p>
        )}
      </main>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
      {renaming && (
        <RenameDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await renameProject(renaming.id, name);
            setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <Dialog title={t('common.delete')} onClose={() => setDeleting(null)}>
          <p className="text-sm text-zinc-300">{t('home.deleteConfirm', { name: deleting.name })}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await removeProject(deleting.id);
                setDeleting(null);
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-16 text-center">
      <Icon name="film" className="mb-4 h-10 w-10 text-zinc-600" />
      <p className="max-w-sm text-sm text-zinc-400">{t('home.empty')}</p>
      <Button className="mt-6" variant="primary" onClick={onCreate} icon="plus">
        {t('home.newProject')}
      </Button>
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const info = FORMATS[project.format];
  const ratio = info.width / info.height;
  return (
    <li className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition hover:border-violet-500/50 hover:bg-zinc-900">
      <button type="button" onClick={onOpen} className="block w-full p-4 text-left">
        <div className="mb-4 flex h-28 items-center justify-center rounded-xl bg-zinc-950/80">
          <div
            className="flex items-center justify-center rounded-md bg-gradient-to-br from-violet-600/40 to-fuchsia-600/20 text-[10px] font-medium text-violet-200"
            style={{ height: 88, width: Math.round(88 * ratio) }}
          >
            {info.label}
          </div>
        </div>
        <h3 className="truncate font-medium text-zinc-100">{project.name}</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {info.hint} · {t('home.clips', { count: project.clipCount })}
        </p>
        <p className="text-xs text-zinc-500">{t('home.updated', { when: formatRelativeDate(project.updatedAt) })}</p>
      </button>
      <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <Button size="icon" title={t('common.rename')} onClick={onRename} icon="edit" aria-label={t('common.rename')} />
        <Button size="icon" title={t('common.delete')} onClick={onDelete} icon="trash" aria-label={t('common.delete')} />
      </div>
    </li>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('9:16');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await createAndOpenProject(name, format);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('home.newProject')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">{t('home.projectName')}</span>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('home.projectNamePlaceholder')} />
        </label>
        <fieldset>
          <legend className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-400">{t('home.chooseFormat')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {FORMAT_LIST.map((f) => {
              const info = FORMATS[f];
              const selected = f === format;
              return (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-xs transition ${
                    selected ? 'border-violet-500 bg-violet-500/10 text-violet-100' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span
                    className={`block rounded-sm ${selected ? 'bg-violet-400' : 'bg-zinc-600'}`}
                    style={{ height: 36, width: Math.round((36 * info.width) / info.height) }}
                  />
                  <span className="font-semibold">{info.label}</span>
                  <span className="text-[10px] text-zinc-500">{info.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  project,
  onClose,
  onSubmit,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  return (
    <Dialog title={t('home.rename')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(name.trim() || project.name);
        }}
        className="space-y-5"
      >
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('common.rename')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
