import { describe, expect, it } from 'vitest';
import { exportFileName, getPreset, mp4Args, overallProgress, parseFfmpegTime, presetForFormat, videoBitrate } from '../src/features/export/presets';

describe('préréglages d’export', () => {
  it('résolutions des réseaux sociaux', () => {
    expect(getPreset('tiktok')).toMatchObject({ width: 1080, height: 1920, format: '9:16' });
    expect(getPreset('square')).toMatchObject({ width: 1080, height: 1080 });
    expect(getPreset('youtube')).toMatchObject({ width: 1920, height: 1080 });
    expect(presetForFormat('16:9')).toBe('youtube');
  });

  it('débit selon qualité et ips', () => {
    const good = videoBitrate(1080, 1920, 30, 'good');
    const high = videoBitrate(1080, 1920, 30, 'high');
    expect(high).toBeGreaterThan(good);
    expect(videoBitrate(1080, 1920, 60, 'good')).toBe(good * 2);
    expect(good).toBeGreaterThan(4_000_000);
  });

  it('arguments ffmpeg H.264 + AAC', () => {
    const args = mp4Args({ preset: 'tiktok', quality: 'high', fps: 60, container: 'mp4' }, 'in.webm', 'out.mp4');
    expect(args.slice(0, 2)).toEqual(['-i', 'in.webm']);
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('yuv420p');
    expect(args[args.indexOf('-r') + 1]).toBe('60');
    expect(args[args.indexOf('-crf') + 1]).toBe('19');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('lit le temps dans les logs ffmpeg', () => {
    expect(parseFfmpegTime('frame=  120 fps= 30 q=28.0 size=     256kB time=00:00:04.00 bitrate= 524.3kbits/s')).toBe(4);
    expect(parseFfmpegTime('time=01:02:03.5')).toBeCloseTo(3723.5);
    expect(parseFfmpegTime('Stream #0:0: Video: vp9')).toBeUndefined();
  });

  it('nom de fichier sûr', () => {
    expect(exportFileName('Ma vidéo d’été !', 'mp4')).toBe('Ma-video-dete.mp4');
    expect(exportFileName('***', 'webm')).toBe('clipstudio.webm');
  });

  it('progression globale', () => {
    expect(overallProgress('render', 0.5, 'webm')).toBe(0.5);
    expect(overallProgress('render', 1, 'mp4')).toBeCloseTo(0.6);
    expect(overallProgress('encode', 0.5, 'mp4')).toBeCloseTo(0.8);
    expect(overallProgress('encode', 2, 'mp4')).toBe(1);
  });
});
