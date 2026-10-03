import type { MediaAsset } from '@/types';
import { t } from '@/lib/i18n';
import { newId } from '@/lib/ids';
import { formatDurationLabel } from '@/lib/time';
import { createClip } from '@/lib/project';
import { appendClip } from '@/lib/timeline/ops';
import { firstTrackOfType } from '@/lib/timeline/clips';
import { useCaptureStore } from '@/store/captureStore';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useUIStore } from '@/store/uiStore';
import { addMediaToProject } from '@/features/projects/persistence';
import { getCaptureEngine } from './engine';

let countdownTimer: number | null = null;

function clearCountdown() {
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = null;
}

/** Lance l'enregistrement (avec compte à rebours 3-2-1 si activé). */
export function startRecordingFlow() {
  const store = useCaptureStore.getState();
  if (store.recState !== 'idle') return;
  const engine = getCaptureEngine();
  if (!engine.hasVideoSource()) {
    useUIStore.getState().notify(t('capture.noSource'), 'error');
    return;
  }
  if (!store.settings.countdown) {
    engine.startRecording();
    return;
  }
  store.set({ recState: 'countdown', countdown: 3 });
  countdownTimer = window.setInterval(() => {
    const current = useCaptureStore.getState();
    if (current.recState !== 'countdown') {
      clearCountdown();
      return;
    }
    if (current.countdown <= 1) {
      clearCountdown();
      current.set({ countdown: 0, recState: 'idle' });
      engine.startRecording();
    } else {
      current.set({ countdown: current.countdown - 1 });
    }
  }, 1000);
}

export function cancelCountdown() {
  clearCountdown();
  useCaptureStore.getState().set({ recState: 'idle', countdown: 0 });
}

/** Arrête l'enregistrement et ajoute le clip à la fin de la timeline. */
export async function stopRecordingFlow() {
  const engine = getCaptureEngine();
  const result = await engine.stopRecording();
  const captureStore = useCaptureStore.getState();
  if (!result || result.duration < 0.2) {
    captureStore.set({ recState: 'idle', elapsed: 0 });
    return;
  }
  const projectStore = useProjectStore.getState();
  const project = projectStore.project;
  if (!project) {
    captureStore.set({ recState: 'idle', elapsed: 0 });
    return;
  }
  const count = Object.values(projectStore.media).filter((m) => m.name.startsWith(t('capture.recording'))).length + 1;
  const asset: MediaAsset = {
    id: newId('media'),
    projectId: project.id,
    name: `${t('capture.recording')} ${count}`,
    kind: 'video',
    mimeType: result.mimeType,
    duration: result.duration,
    width: result.width,
    height: result.height,
    size: result.blob.size,
    hasAudio: result.hasAudio,
    createdAt: Date.now(),
  };
  try {
    await addMediaToProject(asset, result.blob);
    const current = useProjectStore.getState().project;
    if (current) {
      const track = firstTrackOfType(current, 'video');
      const clip = createClip(current, { type: 'video', trackId: track?.id, mediaId: asset.id, duration: result.duration, name: asset.name });
      if (clip) {
        useProjectStore.getState().commit((p) => appendClip(p, clip));
        usePlaybackStore.getState().select(clip.id);
      }
    }
    useUIStore.getState().notify(t('capture.clipAdded', { duration: formatDurationLabel(result.duration) }), 'success');
  } catch (error) {
    useUIStore.getState().notify(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    useCaptureStore.getState().set({ recState: 'idle', elapsed: 0 });
  }
}

/** Raccourci R : démarrer / arrêter. */
export function toggleRecording() {
  const state = useCaptureStore.getState().recState;
  if (state === 'idle') startRecordingFlow();
  else if (state === 'countdown') cancelCountdown();
  else if (state === 'recording' || state === 'paused') void stopRecordingFlow();
}

/** Raccourci P : pause / reprise. */
export function togglePause() {
  const engine = getCaptureEngine();
  const state = useCaptureStore.getState().recState;
  if (state === 'recording') engine.pauseRecording();
  else if (state === 'paused') engine.resumeRecording();
}
