import { projectDuration } from '@/lib/timeline/clips';
import { useCaptureStore } from '@/store/captureStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useProjectStore } from '@/store/projectStore';
import { useUIStore } from '@/store/uiStore';

/** Lecture / pause de l'aperçu (bascule sur l'onglet Aperçu si besoin). */
export function togglePlayback() {
  const playback = usePlaybackStore.getState();
  if (playback.playing) {
    playback.pause();
    return;
  }
  if (useCaptureStore.getState().recState !== 'idle') return;
  const project = useProjectStore.getState().project;
  if (!project || projectDuration(project) === 0) return;
  const ui = useUIStore.getState();
  if (ui.centerTab !== 'preview') ui.setCenterTab('preview');
  playback.play();
}

/** Déplace la tête de lecture de `delta` secondes. */
export function nudgePlayhead(delta: number) {
  const playback = usePlaybackStore.getState();
  const project = useProjectStore.getState().project;
  const duration = project ? projectDuration(project) : 0;
  playback.setCurrentTime(Math.min(Math.max(0, playback.currentTime + delta), Math.max(duration, 0)));
}

export function seekToStart() {
  usePlaybackStore.getState().setCurrentTime(0);
}

export function seekToEnd() {
  const project = useProjectStore.getState().project;
  usePlaybackStore.getState().setCurrentTime(project ? projectDuration(project) : 0);
}
