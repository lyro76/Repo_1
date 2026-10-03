import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { formatBytes, formatDurationLabel } from '@/lib/time';
import { projectDuration } from '@/lib/timeline/clips';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';
import { Button, Dialog, Field, SegmentedControl, TextInput } from '@/app/ui';
import { Icon } from '@/app/Icons';
import { downloadBlob, ExportCancelled, exportProject, type ExportPhase } from './exporter';
import { exportFileName, getPreset, overallProgress, PRESETS, presetForFormat, type Container, type ExportSettings, type Quality } from './presets';

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; phase: ExportPhase; ratio: number }
  | { kind: 'done'; blob: Blob; url: string; fileName: string }
  | { kind: 'error'; message: string };

const SETTINGS_KEY = 'clipstudio.export.settings';

function loadSaved(): Partial<ExportSettings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ExportSettings>;
  } catch {
    return {};
  }
}

export function ExportDialog() {
  const project = useProjectStore((s) => s.project);
  const mediaUrls = useProjectStore((s) => s.mediaUrls);
  const setExportOpen = useUIStore((s) => s.setExportOpen);
  const notify = useUIStore((s) => s.notify);
  const saved = useMemo(loadSaved, []);
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    preset: project ? presetForFormat(project.format) : 'tiktok',
    quality: saved.quality ?? 'good',
    fps: project?.fps === 60 ? 60 : 30,
    container: saved.container ?? 'mp4',
  }));
  const [fileName, setFileName] = useState(() => exportFileName(project?.name ?? '', settings.container).replace(/\.\w+$/, ''));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    usePlaybackStore.getState().pause();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      if (status.kind === 'done') URL.revokeObjectURL(status.url);
    },
    [status],
  );

  if (!project) return null;
  const duration = projectDuration(project);
  const preset = getPreset(settings.preset);
  const running = status.kind === 'running';

  const update = (patch: Partial<ExportSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quality: next.quality, container: next.container }));
    } catch {
      // ignore
    }
  };

  const close = () => {
    if (running) return;
    setExportOpen(false);
  };

  const start = async () => {
    if (duration <= 0) {
      notify(t('export.emptyProject'), 'error');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'running', phase: 'render', ratio: 0 });
    useUIStore.getState().setExporting(true);
    try {
      const blob = await exportProject(
        project,
        mediaUrls,
        settings,
        (phase, ratio) => setStatus({ kind: 'running', phase, ratio }),
        controller.signal,
      );
      const name = `${fileName.trim() || 'clipstudio'}.${settings.container}`;
      const url = URL.createObjectURL(blob);
      setStatus({ kind: 'done', blob, url, fileName: name });
      downloadBlob(blob, name);
      notify(t('export.done', { size: formatBytes(blob.size) }), 'success');
    } catch (error) {
      if (error instanceof ExportCancelled || controller.signal.aborted) {
        setStatus({ kind: 'idle' });
        notify(t('export.cancelled'));
      } else {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      abortRef.current = null;
      useUIStore.getState().setExporting(false);
    }
  };

  const progress = running ? overallProgress(status.phase, status.ratio, settings.container) : 0;
  const phaseLabel = running
    ? status.phase === 'render'
      ? t('export.rendering', { percent: Math.round(status.ratio * 100) })
      : status.phase === 'load'
        ? t('export.loadingFfmpeg')
        : t('export.encoding', { percent: Math.round(status.ratio * 100) })
    : '';

  return (
    <Dialog title={t('export.title')} onClose={close} wide>
      {status.kind === 'done' ? (
        <div className="space-y-4">
          <div className="flex justify-center rounded-lg bg-black p-2">
            <video src={status.url} controls className="max-h-80 rounded" />
          </div>
          <p className="text-sm text-zinc-300">
            {status.fileName} · {formatBytes(status.blob.size)}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setStatus({ kind: 'idle' })}>{t('export.again')}</Button>
            <Button variant="primary" icon="download" onClick={() => downloadBlob(status.blob, status.fileName)}>
              {t('export.download')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <fieldset disabled={running} className="space-y-5">
            <div role="group" aria-label={t('export.preset')}>
              <span className="field-label">{t('export.preset')}</span>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => update({ preset: p.id })}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition ${
                      settings.preset === p.id ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <span
                      className={`block rounded-sm ${settings.preset === p.id ? 'bg-violet-400' : 'bg-zinc-600'}`}
                      style={{ height: 34, width: Math.round((34 * p.width) / p.height) }}
                    />
                    <span className="text-xs font-semibold text-zinc-100">{t(p.labelKey)}</span>
                    <span className="text-[11px] text-zinc-500">{t(p.hintKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            {preset.format !== project.format && (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('export.mismatch', { project: project.format })}
              </p>
            )}

            <div className="grid grid-cols-3 gap-4">
              <Field group label={t('export.quality')}>
                <SegmentedControl<Quality>
                  value={settings.quality}
                  onChange={(quality) => update({ quality })}
                  options={[
                    { value: 'good', label: t('export.quality.good') },
                    { value: 'high', label: t('export.quality.high') },
                  ]}
                />
              </Field>
              <Field group label={t('export.fps')}>
                <SegmentedControl<string>
                  value={String(settings.fps)}
                  onChange={(fps) => update({ fps: fps === '60' ? 60 : 30 })}
                  options={[
                    { value: '30', label: '30' },
                    { value: '60', label: '60' },
                  ]}
                />
              </Field>
              <Field label={t('export.fileName')}>
                <TextInput value={fileName} onChange={(e) => setFileName(e.target.value)} />
              </Field>
            </div>

            <div role="radiogroup" aria-label={t('export.container')} className="space-y-2">
              <span className="field-label">{t('export.container')}</span>
              {(['mp4', 'webm'] as Container[]).map((container) => (
                <label
                  key={container}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                    settings.container === container ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="container"
                    className="accent-violet-500"
                    checked={settings.container === container}
                    onChange={() => update({ container })}
                  />
                  {t(`export.container.${container}`)}
                </label>
              ))}
              {settings.container === 'mp4' && <p className="text-[11px] text-zinc-500">{t('export.mp4Hint')}</p>}
            </div>
          </fieldset>

          <p className="text-xs text-zinc-500">
            {t('export.duration', { duration: formatDurationLabel(duration) })} · {t('export.realtimeHint')}
          </p>

          {running && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-zinc-300">
                <span>{phaseLabel}</span>
                <span className="tabular-nums">{Math.round(progress * 100)} %</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-violet-500 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}

          {status.kind === 'error' && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{t('export.failed', { error: status.message })}</p>
          )}

          <div className="flex justify-end gap-2">
            {running ? (
              <Button variant="danger" icon="close" onClick={() => abortRef.current?.abort()}>
                {t('export.cancel')}
              </Button>
            ) : (
              <>
                <Button onClick={close}>{t('common.cancel')}</Button>
                <Button variant="primary" icon="export" disabled={duration <= 0} onClick={() => void start()}>
                  {t('export.start')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
