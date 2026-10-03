import { t } from '@/lib/i18n';
import { useUIStore } from '@/store/uiStore';
import { TopBar } from './TopBar';
import { CaptureStudio } from '@/features/capture/CaptureStudio';
import { CaptureSettingsPanel } from '@/features/capture/CaptureSettingsPanel';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { Timeline } from '@/features/timeline/Timeline';
import { Toolbar } from '@/features/editor/Toolbar';
import { PropertiesPanel } from '@/features/editor/PropertiesPanel';
import { ProjectPanel } from '@/features/editor/ProjectPanel';
import { MediaPanel } from '@/features/editor/MediaPanel';
import { ExportDialog } from '@/features/export/ExportDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useEditorShortcuts } from '@/features/editor/useEditorShortcuts';
import { useEffect } from 'react';
import { disposeCaptureEngine } from '@/features/capture/engine';

function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-zinc-800 bg-zinc-900/60 px-1">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-3 text-xs font-medium transition ${
            value === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {tab.label}
          {value === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-violet-500" />}
        </button>
      ))}
    </div>
  );
}

export function EditorLayout() {
  const centerTab = useUIStore((s) => s.centerTab);
  const setCenterTab = useUIStore((s) => s.setCenterTab);
  const leftTab = useUIStore((s) => s.leftTab);
  const setLeftTab = useUIStore((s) => s.setLeftTab);
  const rightTab = useUIStore((s) => s.rightTab);
  const setRightTab = useUIStore((s) => s.setRightTab);
  const exportOpen = useUIStore((s) => s.exportOpen);
  const shortcutsOpen = useUIStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);

  useEditorShortcuts();

  // Libère caméra, écran et micro en quittant l'éditeur.
  useEffect(() => () => disposeCaptureEngine(), []);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {/* Colonne gauche : réglages du studio ou médias */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
          <Tabs
            value={leftTab}
            onChange={setLeftTab}
            tabs={[
              { id: 'studio', label: t('tabs.studio') },
              { id: 'media', label: t('tabs.media') },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">{leftTab === 'studio' ? <CaptureSettingsPanel /> : <MediaPanel />}</div>
        </aside>

        {/* Centre : aperçu ou studio */}
        <main className="flex min-w-0 flex-1 flex-col bg-zinc-950">
          <Tabs
            value={centerTab}
            onChange={setCenterTab}
            tabs={[
              { id: 'studio', label: t('capture.title') },
              { id: 'preview', label: t('tabs.preview') },
            ]}
          />
          <div className="relative min-h-0 flex-1">
            <div className={centerTab === 'studio' ? 'absolute inset-0' : 'hidden'}>
              <CaptureStudio active={centerTab === 'studio'} />
            </div>
            <div className={centerTab === 'preview' ? 'absolute inset-0' : 'hidden'}>
              <PreviewPanel active={centerTab === 'preview'} />
            </div>
          </div>
        </main>

        {/* Colonne droite : propriétés */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/40">
          <Tabs
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { id: 'properties', label: t('tabs.properties') },
              { id: 'project', label: t('tabs.project') },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">{rightTab === 'properties' ? <PropertiesPanel /> : <ProjectPanel />}</div>
        </aside>
      </div>

      {/* Bas : outils + timeline */}
      <section className="flex h-[300px] shrink-0 flex-col border-t border-zinc-800 bg-zinc-900/60">
        <Toolbar />
        <div className="min-h-0 flex-1">
          <Timeline />
        </div>
      </section>

      {exportOpen && <ExportDialog />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
