import type { Clip, Project, Track, TrackType } from '@/types';
import { roundTime } from '@/lib/time';
import {
  MIN_CLIP_DURATION,
  clipEnd,
  findTrack,
  maxClipDuration,
  trackClips,
  trackEnd,
  trackTypeForClip,
} from './clips';

function touch(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

function withClip(project: Project, clip: Clip): Project {
  return touch({ ...project, clips: { ...project.clips, [clip.id]: clip } });
}

function replaceTrack(project: Project, track: Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? track : t)) };
}

/** Réordonne les identifiants de clips d'une piste par position. */
function sortTrackIds(project: Project, trackId: string): Project {
  const track = findTrack(project, trackId);
  if (!track) return project;
  const ordered = trackClips(project, trackId).map((c) => c.id);
  return replaceTrack(project, { ...track, clipIds: ordered });
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const next: Clip = { ...clip, ...patch, id: clip.id };
  return sortTrackIds(withClip(project, next), next.trackId);
}

/**
 * Trouve la position libre la plus proche de `desired` sur une piste,
 * pour un clip de durée `duration`, en ignorant les clips `others`.
 */
export function nearestFreeStart(others: Clip[], duration: number, desired: number): number {
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const wanted = Math.max(0, desired);
  const candidates: number[] = [];
  let gapStart = 0;
  for (const other of sorted) {
    const gapEnd = other.start;
    if (gapEnd - gapStart >= duration - 1e-6) {
      candidates.push(Math.min(Math.max(wanted, gapStart), gapEnd - duration));
    }
    gapStart = Math.max(gapStart, clipEnd(other));
  }
  candidates.push(Math.max(wanted, gapStart));
  let best = candidates[0] ?? 0;
  for (const c of candidates) {
    if (Math.abs(c - wanted) < Math.abs(best - wanted)) best = c;
  }
  return roundTime(Math.max(0, best));
}

/** Déplace un clip (éventuellement vers une autre piste compatible) sans chevauchement. */
export function moveClip(project: Project, clipId: string, desiredStart: number, targetTrackId?: string): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const target = findTrack(project, targetTrackId ?? clip.trackId);
  const source = findTrack(project, clip.trackId);
  if (!target || !source) return project;
  if (target.type !== trackTypeForClip(clip.type)) return project;

  const others = trackClips(project, target.id).filter((c) => c.id !== clipId);
  const start = nearestFreeStart(others, clip.duration, desiredStart);
  if (target.id === clip.trackId && start === clip.start) return project;

  let next: Project = project;
  if (target.id !== source.id) {
    next = replaceTrack(next, { ...source, clipIds: source.clipIds.filter((id) => id !== clipId) });
    const freshTarget = findTrack(next, target.id) ?? target;
    next = replaceTrack(next, { ...freshTarget, clipIds: [...freshTarget.clipIds, clipId] });
  }
  next = withClip(next, { ...clip, start, trackId: target.id });
  return sortTrackIds(next, target.id);
}

/** Coupe un clip à l'instant `time`. Retourne le projet inchangé si la coupe est hors du clip. */
export function splitClipAt(project: Project, clipId: string, time: number, newClipId: string): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const t = roundTime(time);
  if (t <= clip.start + MIN_CLIP_DURATION || t >= clipEnd(clip) - MIN_CLIP_DURATION) return project;

  const left: Clip = {
    ...clip,
    duration: roundTime(t - clip.start),
    transitionOut: undefined,
  };
  const right: Clip = {
    ...clip,
    id: newClipId,
    start: t,
    inPoint: roundTime(clip.inPoint + (t - clip.start) * clip.speed),
    duration: roundTime(clipEnd(clip) - t),
    transitionIn: undefined,
  };
  const track = findTrack(project, clip.trackId);
  if (!track) return project;
  const index = track.clipIds.indexOf(clipId);
  const clipIds = [...track.clipIds];
  clipIds.splice(index + 1, 0, newClipId);
  let next = replaceTrack(project, { ...track, clipIds });
  next = { ...next, clips: { ...next.clips, [left.id]: left, [right.id]: right } };
  return touch(next);
}

export type TrimEdge = 'start' | 'end';

/**
 * Rogne un clip en déplaçant un de ses bords vers `newTime` (temps timeline).
 * Respecte la durée minimale, les bornes du média source et les clips voisins.
 */
export function trimClip(
  project: Project,
  clipId: string,
  edge: TrimEdge,
  newTime: number,
  mediaDuration?: number,
): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const neighbours = trackClips(project, clip.trackId).filter((c) => c.id !== clipId);
  const end = clipEnd(clip);
  const hasMedia = clip.type === 'video' || clip.type === 'audio';

  if (edge === 'start') {
    const prevEnd = neighbours.filter((c) => clipEnd(c) <= clip.start + 1e-6).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const earliestBySource = hasMedia ? clip.start - clip.inPoint / clip.speed : 0;
    const min = Math.max(0, prevEnd, earliestBySource);
    const max = end - MIN_CLIP_DURATION;
    const start = roundTime(Math.min(max, Math.max(min, newTime)));
    const delta = start - clip.start;
    if (Math.abs(delta) < 1e-6) return project;
    return withClip(project, {
      ...clip,
      start,
      inPoint: hasMedia ? roundTime(clip.inPoint + delta * clip.speed) : clip.inPoint,
      duration: roundTime(clip.duration - delta),
    });
  }

  const nextStart = neighbours.filter((c) => c.start >= end - 1e-6).reduce((m, c) => Math.min(m, c.start), Number.POSITIVE_INFINITY);
  const maxBySource = hasMedia ? clip.start + maxClipDuration(clip, mediaDuration) : Number.POSITIVE_INFINITY;
  const max = Math.min(nextStart, maxBySource);
  const min = clip.start + MIN_CLIP_DURATION;
  const newEnd = roundTime(Math.min(max, Math.max(min, newTime)));
  const duration = roundTime(newEnd - clip.start);
  if (Math.abs(duration - clip.duration) < 1e-6) return project;
  return withClip(project, { ...clip, duration });
}

export function deleteClips(project: Project, clipIds: string[]): Project {
  const toDelete = new Set(clipIds.filter((id) => project.clips[id]));
  if (toDelete.size === 0) return project;
  const clips: Record<string, Clip> = {};
  for (const [id, clip] of Object.entries(project.clips)) {
    if (!toDelete.has(id)) clips[id] = clip;
  }
  const tracks = project.tracks.map((t) => ({ ...t, clipIds: t.clipIds.filter((id) => !toDelete.has(id)) }));
  return touch({ ...project, clips, tracks });
}

/** Duplique un clip juste après l'original (ou à la place libre la plus proche). */
export function duplicateClip(project: Project, clipId: string, newClipId: string): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const copy: Clip = { ...clip, id: newClipId, props: clip.props ? { ...clip.props } : undefined };
  return insertClip(project, copy, clipEnd(clip));
}

/** Insère un clip sur sa piste à la position libre la plus proche de `desiredStart`. */
export function insertClip(project: Project, clip: Clip, desiredStart: number): Project {
  const track = findTrack(project, clip.trackId);
  if (!track || track.type !== trackTypeForClip(clip.type)) return project;
  const start = nearestFreeStart(trackClips(project, track.id), clip.duration, desiredStart);
  const placed: Clip = { ...clip, start };
  let next = replaceTrack(project, { ...track, clipIds: [...track.clipIds, placed.id] });
  next = withClip(next, placed);
  return sortTrackIds(next, track.id);
}

/** Ajoute un clip à la fin de sa piste. */
export function appendClip(project: Project, clip: Clip): Project {
  return insertClip(project, clip, trackEnd(project, clip.trackId));
}

export function addTrack(project: Project, type: TrackType, id: string, name: string): Project {
  const track: Track = { id, type, name, clipIds: [], muted: false };
  const lastIndex = project.tracks.map((t) => t.type).lastIndexOf(type);
  const tracks = [...project.tracks];
  tracks.splice(lastIndex === -1 ? tracks.length : lastIndex + 1, 0, track);
  return touch({ ...project, tracks });
}

/** Supprime une piste (et ses clips). La dernière piste d'un type ne peut pas être supprimée. */
export function removeTrack(project: Project, trackId: string): Project {
  const track = findTrack(project, trackId);
  if (!track) return project;
  const sameType = project.tracks.filter((t) => t.type === track.type);
  if (sameType.length <= 1) return project;
  const cleared = deleteClips(project, track.clipIds);
  return touch({ ...cleared, tracks: cleared.tracks.filter((t) => t.id !== trackId) });
}

export function setTrackMuted(project: Project, trackId: string, muted: boolean): Project {
  const track = findTrack(project, trackId);
  if (!track || track.muted === muted) return project;
  return touch(replaceTrack(project, { ...track, muted }));
}

export function renameTrack(project: Project, trackId: string, name: string): Project {
  const track = findTrack(project, trackId);
  if (!track) return project;
  return touch(replaceTrack(project, { ...track, name }));
}
