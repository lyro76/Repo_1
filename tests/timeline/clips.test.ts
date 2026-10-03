import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../helpers';
import {
  clipEnd,
  clipsAtTime,
  maxClipDuration,
  nextClipOnTrack,
  orderedTracks,
  prevClipOnTrack,
  projectDuration,
  sourceTimeAt,
  trackClips,
  trackTypeForClip,
} from '../../src/lib/timeline/clips';

describe('clips', () => {
  const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
  const b = makeClip({ id: 'b', trackId: 'video-1', start: 6, duration: 2 });
  const m = makeClip({ id: 'm', trackId: 'audio-1', type: 'audio', start: 1, duration: 10 });
  const project = makeProject([b, a, m]);

  it('calcule fin, durée et clips actifs', () => {
    expect(clipEnd(b)).toBe(8);
    expect(projectDuration(project)).toBe(11);
    expect(clipsAtTime(project, 7).map((c) => c.id).sort()).toEqual(['b', 'm']);
    expect(clipsAtTime(project, 4).map((c) => c.id)).toEqual(['m']);
  });

  it('trie les clips d’une piste', () => {
    expect(trackClips(project, 'video-1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(nextClipOnTrack(project, a)?.id).toBe('b');
    expect(prevClipOnTrack(project, b)?.id).toBe('a');
    expect(prevClipOnTrack(project, a)).toBeUndefined();
  });

  it('convertit le temps timeline en temps source avec la vitesse', () => {
    const fast = makeClip({ trackId: 'video-1', start: 10, inPoint: 2, duration: 5, speed: 2 });
    expect(sourceTimeAt(fast, 11)).toBe(4);
    expect(maxClipDuration(fast, 12)).toBe(5);
    expect(maxClipDuration(fast, undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('associe les types de clips aux pistes', () => {
    expect(trackTypeForClip('image')).toBe('video');
    expect(trackTypeForClip('audio')).toBe('audio');
    expect(trackTypeForClip('text')).toBe('text');
    expect(orderedTracks(project).map((t) => t.type)).toEqual(['text', 'video', 'audio']);
  });
});
