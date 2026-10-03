import type { Clip, ClipType, Format, Project, ProjectSummary, Track } from '@/types';
import { newId } from './ids';
import { t } from './i18n';
import { trackTypeForClip } from './timeline/clips';

export const DEFAULT_FPS = 30;

export function createTrack(type: Track['type'], name?: string): Track {
  return {
    id: newId('track'),
    type,
    name: name ?? t(`timeline.track.${type}`),
    clipIds: [],
    muted: false,
  };
}

export function createProject(name: string, format: Format, fps = DEFAULT_FPS): Project {
  const now = Date.now();
  return {
    id: newId('project'),
    name: name.trim() || t('common.untitled'),
    format,
    fps,
    tracks: [createTrack('text'), createTrack('video'), createTrack('audio')],
    clips: {},
    createdAt: now,
    updatedAt: now,
  };
}

export type NewClipInput = {
  type: ClipType;
  trackId?: string;
  mediaId?: string;
  duration: number;
  name?: string;
  inPoint?: number;
  props?: Record<string, unknown>;
};

/** Crée un clip prêt à être inséré (la position `start` est fixée à l'insertion). */
export function createClip(project: Project, input: NewClipInput): Clip | undefined {
  const trackType = trackTypeForClip(input.type);
  const track = input.trackId
    ? project.tracks.find((tr) => tr.id === input.trackId && tr.type === trackType)
    : project.tracks.find((tr) => tr.type === trackType);
  if (!track) return undefined;
  return {
    id: newId('clip'),
    trackId: track.id,
    mediaId: input.mediaId,
    type: input.type,
    start: 0,
    inPoint: input.inPoint ?? 0,
    duration: input.duration,
    speed: 1,
    volume: 1,
    muted: false,
    name: input.name,
    props: input.props,
  };
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    format: project.format,
    fps: project.fps,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    clipCount: Object.keys(project.clips).length,
  };
}

/** Complète un projet chargé depuis le stockage avec les champs manquants (migration légère). */
export function normalizeProject(raw: Project): Project {
  const clips: Record<string, Clip> = {};
  for (const [id, clip] of Object.entries(raw.clips ?? {})) {
    clips[id] = {
      ...clip,
      id,
      speed: clip.speed ?? 1,
      volume: clip.volume ?? 1,
      muted: clip.muted ?? false,
      inPoint: clip.inPoint ?? 0,
    };
  }
  const tracks = (raw.tracks ?? []).map((tr) => ({ ...tr, clipIds: tr.clipIds.filter((cid) => clips[cid]) }));
  const hasType = (type: Track['type']) => tracks.some((tr) => tr.type === type);
  if (!hasType('text')) tracks.unshift(createTrack('text'));
  if (!hasType('video')) tracks.push(createTrack('video'));
  if (!hasType('audio')) tracks.push(createTrack('audio'));
  return {
    ...raw,
    fps: raw.fps || DEFAULT_FPS,
    tracks,
    clips,
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
  };
}
