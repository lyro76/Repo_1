import type { Clip, Project, Track } from '../src/types';

let seq = 0;

export function makeTrack(type: Track['type'], id = `${type}-${++seq}`): Track {
  return { id, type, name: type, clipIds: [], muted: false };
}

export function makeClip(partial: Partial<Clip> & { trackId: string }): Clip {
  return {
    id: partial.id ?? `clip-${++seq}`,
    type: 'video',
    start: 0,
    inPoint: 0,
    duration: 5,
    speed: 1,
    volume: 1,
    muted: false,
    ...partial,
  };
}

/** Projet de test : une piste texte, une piste vidéo, une piste audio. */
export function makeProject(clips: Clip[] = []): Project {
  const tracks = [makeTrack('text', 'text-1'), makeTrack('video', 'video-1'), makeTrack('audio', 'audio-1')];
  const byId: Record<string, Clip> = {};
  for (const clip of clips) {
    byId[clip.id] = clip;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track) throw new Error(`piste inconnue ${clip.trackId}`);
    track.clipIds.push(clip.id);
  }
  return {
    id: 'p1',
    name: 'Test',
    format: '9:16',
    fps: 30,
    tracks,
    clips: byId,
    createdAt: 0,
    updatedAt: 0,
  };
}
