import type { Clip, ClipType, Project, Track, TrackType } from '@/types';

export const MIN_CLIP_DURATION = 0.1;

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

export function findClipTrack(project: Project, clipId: string): Track | undefined {
  const clip = project.clips[clipId];
  return clip ? findTrack(project, clip.trackId) : undefined;
}

/** Type de piste qui accueille un type de clip. */
export function trackTypeForClip(type: ClipType): TrackType {
  if (type === 'audio') return 'audio';
  if (type === 'text') return 'text';
  return 'video';
}

export function firstTrackOfType(project: Project, type: TrackType): Track | undefined {
  return project.tracks.find((t) => t.type === type);
}

/** Clips d'une piste, triés par position. */
export function trackClips(project: Project, trackId: string): Clip[] {
  const track = findTrack(project, trackId);
  if (!track) return [];
  return track.clipIds
    .map((id) => project.clips[id])
    .filter((c): c is Clip => Boolean(c))
    .sort((a, b) => a.start - b.start);
}

export function trackEnd(project: Project, trackId: string): number {
  return trackClips(project, trackId).reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/** Durée totale du projet (fin du dernier clip). */
export function projectDuration(project: Project): number {
  let max = 0;
  for (const clip of Object.values(project.clips)) {
    max = Math.max(max, clipEnd(clip));
  }
  return max;
}

export function isClipActiveAt(clip: Clip, time: number): boolean {
  return time >= clip.start && time < clipEnd(clip);
}

/** Temps correspondant dans le média source (prend en compte la vitesse). */
export function sourceTimeAt(clip: Clip, time: number): number {
  return clip.inPoint + (time - clip.start) * clip.speed;
}

/** Durée maximale affichable d'un clip média compte tenu de son point d'entrée et de sa vitesse. */
export function maxClipDuration(clip: Clip, mediaDuration: number | undefined): number {
  if (mediaDuration === undefined || mediaDuration <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(MIN_CLIP_DURATION, (mediaDuration - clip.inPoint) / clip.speed);
}

export function clipsAtTime(project: Project, time: number): Clip[] {
  return Object.values(project.clips).filter((c) => isClipActiveAt(c, time));
}

/** Clip actif sur une piste à un instant donné. */
export function clipOnTrackAt(project: Project, trackId: string, time: number): Clip | undefined {
  return trackClips(project, trackId).find((c) => isClipActiveAt(c, time));
}

/** Clip qui suit immédiatement `clip` sur sa piste (le prochain par ordre de début). */
export function nextClipOnTrack(project: Project, clip: Clip): Clip | undefined {
  return trackClips(project, clip.trackId).find((c) => c.id !== clip.id && c.start >= clipEnd(clip) - 1e-6);
}

export function prevClipOnTrack(project: Project, clip: Clip): Clip | undefined {
  const before = trackClips(project, clip.trackId).filter((c) => c.id !== clip.id && clipEnd(c) <= clip.start + 1e-6);
  return before[before.length - 1];
}

/** Ordre d'affichage des pistes : textes en haut, puis vidéos, puis audio. */
export function orderedTracks(project: Project): Track[] {
  const rank: Record<TrackType, number> = { text: 0, video: 1, audio: 2 };
  return [...project.tracks].sort((a, b) => rank[a.type] - rank[b.type]);
}
