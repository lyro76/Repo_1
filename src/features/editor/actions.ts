import type { Clip, MediaAsset } from '@/types';
import { t } from '@/lib/i18n';
import { newId } from '@/lib/ids';
import { classifyFile, DEFAULT_IMAGE_DURATION, probeMedia } from '@/lib/media';
import { createClip } from '@/lib/project';
import { makeTextProps } from '@/lib/text';
import { findTrack, trackEnd, trackTypeForClip } from '@/lib/timeline/clips';
import { deleteClips, duplicateClip, insertClip, pickSplitTargets, splitClipsAt, clipsUsingMedia } from '@/lib/timeline/ops';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';
import { addMediaToProject, removeMediaFromProject } from '@/features/projects/persistence';
import { shortcutHandlers } from './useEditorShortcuts';

export const TEXT_DEFAULT_DURATION = 3;

export function splitAtPlayhead() {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return;
  const { currentTime, selectedClipId } = usePlaybackStore.getState();
  const targets = pickSplitTargets(project, currentTime, selectedClipId);
  if (targets.length === 0) {
    useUIStore.getState().notify(t('toast.nothingToSplit'));
    return;
  }
  let created: string[] = [];
  store.commit((p) => {
    const result = splitClipsAt(p, targets, currentTime, () => newId('clip'));
    created = result.created;
    return result.project;
  });
  if (created[0] && selectedClipId) usePlaybackStore.getState().select(created[0]);
  useUIStore.getState().notify(t('toast.clipSplit'));
}

export function deleteSelected() {
  const { selectedClipId, select } = usePlaybackStore.getState();
  if (!selectedClipId) return;
  useProjectStore.getState().commit((p) => deleteClips(p, [selectedClipId]));
  select(null);
}

export function duplicateSelected() {
  const { selectedClipId, select } = usePlaybackStore.getState();
  if (!selectedClipId) return;
  const copyId = newId('clip');
  useProjectStore.getState().commit((p) => duplicateClip(p, selectedClipId, copyId));
  if (useProjectStore.getState().project?.clips[copyId]) {
    select(copyId);
    useUIStore.getState().notify(t('toast.clipDuplicated'));
  }
}

/** Ajoute un texte à la tête de lecture sur la première piste texte. */
export function addTextClip() {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return;
  const clip = createClip(project, {
    type: 'text',
    duration: TEXT_DEFAULT_DURATION,
    props: makeTextProps({ text: t('props.textDefault') }),
  });
  if (!clip) return;
  const time = usePlaybackStore.getState().currentTime;
  store.commit((p) => insertClip(p, clip, time));
  usePlaybackStore.getState().select(clip.id);
  useUIStore.getState().setRightTab('properties');
  useUIStore.getState().notify(t('toast.textAdded'));
}

/** Crée un clip pour un média et le place sur la timeline. */
export function addMediaClip(asset: MediaAsset, options: { trackId?: string; start?: number } = {}): Clip | undefined {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return undefined;
  const type: Clip['type'] = asset.kind === 'image' ? 'image' : asset.kind;
  const trackType = trackTypeForClip(type);
  const track = options.trackId ? findTrack(project, options.trackId) : undefined;
  const trackId = track && track.type === trackType ? track.id : undefined;
  const duration = asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : Math.max(0.1, asset.duration);
  const clip = createClip(project, { type, trackId, mediaId: asset.id, duration, name: asset.name });
  if (!clip) return undefined;
  const start = options.start ?? trackEnd(project, clip.trackId);
  store.commit((p) => insertClip(p, clip, start));
  usePlaybackStore.getState().select(clip.id);
  return clip;
}

/** Importe des fichiers (vidéo, audio, image) et les ajoute à la timeline. */
export async function importFiles(files: FileList | File[], placement: { trackId?: string; start?: number } = {}) {
  const ui = useUIStore.getState();
  let start = placement.start;
  for (const file of Array.from(files)) {
    const project = useProjectStore.getState().project;
    if (!project) return;
    const kind = classifyFile(file.name, file.type);
    if (!kind) {
      ui.notify(t('media.unsupported', { name: file.name }), 'error');
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const probe = await probeMedia(url, kind);
      const asset: MediaAsset = {
        id: newId('media'),
        projectId: project.id,
        name: file.name,
        kind,
        mimeType: file.type || kind,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        size: file.size,
        hasAudio: probe.hasAudio,
        createdAt: Date.now(),
      };
      await addMediaToProject(asset, file);
      const clip = addMediaClip(asset, { trackId: placement.trackId, start });
      if (clip && start !== undefined) start = (useProjectStore.getState().project?.clips[clip.id]?.start ?? start) + clip.duration;
      ui.notify(t('media.imported', { name: file.name }), 'success');
    } catch {
      ui.notify(t('media.importFailed', { name: file.name }), 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Supprime un média et tous ses clips (action irréversible : l'historique est vidé). */
export async function deleteMedia(mediaId: string) {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return;
  const clipIds = clipsUsingMedia(project, mediaId);
  if (clipIds.length > 0) store.commit((p) => deleteClips(p, clipIds));
  store.resetHistory();
  const selected = usePlaybackStore.getState().selectedClipId;
  if (selected && clipIds.includes(selected)) usePlaybackStore.getState().select(null);
  await removeMediaFromProject(mediaId);
  useUIStore.getState().notify(t('toast.mediaDeleted'));
}

// Raccourcis clavier (S, Suppr, Ctrl+D).
shortcutHandlers.split = splitAtPlayhead;
shortcutHandlers.delete = deleteSelected;
shortcutHandlers.duplicate = duplicateSelected;
