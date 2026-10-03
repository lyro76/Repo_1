import type { Format, MediaAsset, Project } from '@/types';
import * as idb from '@/lib/idb';
import { createProject, normalizeProject, summarize } from '@/lib/project';
import { useProjectStore } from '@/store/projectStore';
import { useProjectsStore } from '@/store/projectsStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';

export async function refreshProjects(): Promise<void> {
  const store = useProjectsStore.getState();
  store.setLoading(true);
  try {
    const projects = await idb.listProjects();
    store.setItems(projects.map(summarize));
    store.setError(null);
  } catch (error) {
    store.setError(error instanceof Error ? error.message : String(error));
  } finally {
    store.setLoading(false);
  }
}

export async function createAndOpenProject(name: string, format: Format): Promise<Project> {
  const project = createProject(name, format);
  await idb.putProject(project);
  await openProject(project.id);
  return project;
}

export async function openProject(id: string): Promise<boolean> {
  const raw = await idb.getProject(id);
  if (!raw) return false;
  const project = normalizeProject(raw);
  const records = await idb.listProjectMedia(id);
  const media: MediaAsset[] = [];
  const blobs: Record<string, Blob> = {};
  for (const record of records) {
    const { blob, ...asset } = record;
    media.push(asset);
    blobs[asset.id] = blob;
  }
  usePlaybackStore.getState().reset();
  useProjectStore.getState().load(project, media, blobs);
  useUIStore.getState().setScreen('editor');
  useUIStore.getState().setCenterTab(Object.keys(project.clips).length > 0 ? 'preview' : 'studio');
  return true;
}

export async function closeProject(): Promise<void> {
  await saveCurrentProject();
  useProjectStore.getState().unload();
  usePlaybackStore.getState().reset();
  useUIStore.getState().setScreen('home');
  await refreshProjects();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const current = useProjectStore.getState().project;
  if (current?.id === id) {
    useProjectStore.getState().setMeta({ name });
    await saveCurrentProject();
  } else {
    const project = await idb.getProject(id);
    if (project) await idb.putProject({ ...project, name, updatedAt: Date.now() });
  }
  await refreshProjects();
}

export async function removeProject(id: string): Promise<void> {
  await idb.deleteProject(id);
  await refreshProjects();
}

export async function saveCurrentProject(): Promise<void> {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return;
  store.setSaveState('saving');
  try {
    await idb.putProject(project);
    // Ne pas écraser « dirty » si une modification est arrivée pendant l'écriture.
    if (useProjectStore.getState().project === project) store.setSaveState('saved');
  } catch {
    store.setSaveState('error');
  }
}

/** Ajoute un média (blob + métadonnées) au projet courant et le persiste. */
export async function addMediaToProject(asset: MediaAsset, blob: Blob): Promise<void> {
  await idb.putMedia(asset, blob);
  useProjectStore.getState().registerMedia(asset, blob);
}

export async function removeMediaFromProject(mediaId: string): Promise<void> {
  await idb.deleteMedia(mediaId);
  useProjectStore.getState().forgetMedia(mediaId);
}

const AUTOSAVE_DELAY = 800;

/** Sauvegarde automatique (debounce) à chaque modification du projet. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved: Project | null = useProjectStore.getState().project;

  const unsubscribe = useProjectStore.subscribe((state, previous) => {
    if (!state.project || state.project === previous.project) return;
    if (state.project.id !== previous.project?.id) {
      lastSaved = state.project;
      return;
    }
    if (state.transactionBase) return; // attend la fin du glisser
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const current = useProjectStore.getState().project;
      if (current && current !== lastSaved) {
        lastSaved = current;
        void saveCurrentProject();
      }
    }, AUTOSAVE_DELAY);
  });

  const flush = () => {
    const current = useProjectStore.getState().project;
    if (current && current !== lastSaved) {
      lastSaved = current;
      void idb.putProject(current);
    }
  };
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('pagehide', flush);
  };
}
