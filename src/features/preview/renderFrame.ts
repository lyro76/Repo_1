import type { Clip, Project } from '@/types';
import { clipOnTrackAt, nextClipOnTrack, prevClipOnTrack, orderedTracks } from '@/lib/timeline/clips';
import { transitionStateAt } from '@/lib/timeline/transitions';
import { containRect, coverRect } from '@/features/capture/layout';
import { drawTextBlock } from '@/lib/drawText';
import { getTextProps } from '@/lib/text';
import type { MediaPool } from './mediaPool';

const ADJACENT_EPSILON = 0.05;

function drawVisual(ctx: CanvasRenderingContext2D, clip: Clip, pool: MediaPool, width: number, height: number, alpha: number) {
  let source: CanvasImageSource | null = null;
  let sw = 0;
  let sh = 0;
  if (clip.type === 'video') {
    const video = pool.videoFor(clip);
    if (video) {
      source = video;
      sw = video.videoWidth;
      sh = video.videoHeight;
    }
  } else if (clip.type === 'image' && clip.mediaId) {
    const img = pool.imageFor(clip.mediaId);
    if (img) {
      source = img;
      sw = img.naturalWidth;
      sh = img.naturalHeight;
    }
  }
  if (!source || sw === 0 || sh === 0) return;
  const fit = clip.props?.fit === 'cover' ? 'cover' : 'contain';
  const rect = fit === 'cover' ? coverRect(sw, sh, width, height) : containRect(sw, sh, width, height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/** Dessine l'image de la timeline à l'instant `time`. */
export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, time: number, pool: MediaPool) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const tracks = orderedTracks(project);
  // Pistes vidéo de bas en haut : la première piste affichée est au premier plan.
  const videoTracks = tracks.filter((tr) => tr.type === 'video').reverse();
  for (const track of videoTracks) {
    const clip = clipOnTrackAt(project, track.id, time);
    if (!clip) continue;
    const state = transitionStateAt(clip, time);
    if (state.opacity < 1) {
      // Fondu enchaîné : on dessine l'image figée du clip voisin dessous.
      const inFade = clip.transitionIn?.type === 'fade' && time < clip.start + clip.duration / 2;
      const neighbour = inFade ? prevClipOnTrack(project, clip) : nextClipOnTrack(project, clip);
      const adjacent =
        neighbour &&
        (inFade
          ? Math.abs(neighbour.start + neighbour.duration - clip.start) < ADJACENT_EPSILON
          : Math.abs(neighbour.start - (clip.start + clip.duration)) < ADJACENT_EPSILON);
      if (neighbour && adjacent) drawVisual(ctx, neighbour, pool, width, height, 1);
    }
    drawVisual(ctx, clip, pool, width, height, state.opacity);
    if (state.black > 0) {
      ctx.save();
      ctx.globalAlpha = state.black;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  const textTracks = tracks.filter((tr) => tr.type === 'text').reverse();
  for (const track of textTracks) {
    const clip = clipOnTrackAt(project, track.id, time);
    if (!clip) continue;
    const state = transitionStateAt(clip, time);
    drawTextBlock(ctx, getTextProps(clip), width, height, state.opacity * (1 - state.black));
  }
}
