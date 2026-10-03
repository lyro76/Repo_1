import type { Clip, Transition, TransitionType } from '@/types';
import { t } from '@/lib/i18n';
import { nextClipOnTrack } from '@/lib/timeline/clips';
import { setJunctionTransition, setTransition, TRANSITION_MAX, TRANSITION_MIN, type TransitionEdge } from '@/lib/timeline/ops';
import { useProjectStore } from '@/store/projectStore';
import { Button, Field, Select } from '@/app/ui';

const TYPES: TransitionType[] = ['none', 'fade', 'fadeBlack'];
const DEFAULT_DURATION = 0.5;

function TransitionRow({ clip, edge }: { clip: Clip; edge: TransitionEdge }) {
  const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut;
  const type = transition?.type ?? 'none';
  const duration = transition?.duration ?? DEFAULT_DURATION;
  const max = Math.max(TRANSITION_MIN, Math.min(TRANSITION_MAX, clip.duration / 2));
  const label = edge === 'in' ? t('props.transitionIn') : t('props.transitionOut');

  const apply = (next: Transition | undefined, mode: 'commit' | 'edit') => {
    const store = useProjectStore.getState();
    const mutate = (p: Parameters<typeof setTransition>[0]) => setTransition(p, clip.id, edge, next);
    if (mode === 'commit') store.commit(mutate);
    else store.edit(mutate);
  };

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <Field label={label}>
        <Select value={type} onChange={(e) => apply({ type: e.target.value as TransitionType, duration }, 'commit')}>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`props.transition.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      {type !== 'none' && (
        <Field label={`${t('props.transitionDuration')} · ${duration.toFixed(1)}`}>
          <input
            type="range"
            min={TRANSITION_MIN}
            max={max}
            step={0.1}
            value={Math.min(duration, max)}
            onPointerDown={() => useProjectStore.getState().beginTransaction()}
            onPointerUp={() => useProjectStore.getState().endTransaction()}
            onFocus={() => useProjectStore.getState().beginTransaction()}
            onBlur={() => useProjectStore.getState().endTransaction()}
            onChange={(e) => apply({ type, duration: Number(e.target.value) }, 'edit')}
          />
        </Field>
      )}
    </div>
  );
}

export function TransitionsSection({ clip }: { clip: Clip }) {
  const hasNext = useProjectStore((s) => {
    if (!s.project) return false;
    const next = nextClipOnTrack(s.project, clip);
    return Boolean(next && Math.abs(next.start - (clip.start + clip.duration)) < 0.05);
  });
  const commit = useProjectStore((s) => s.commit);
  return (
    <section className="space-y-3 border-b border-zinc-800 p-4">
      <h3 className="panel-title">{t('props.transitions')}</h3>
      <TransitionRow clip={clip} edge="in" />
      <TransitionRow clip={clip} edge="out" />
      {hasNext && clip.type !== 'audio' && (
        <Button
          size="sm"
          className="w-full"
          onClick={() => commit((p) => setJunctionTransition(p, clip.id, clip.transitionOut ?? { type: 'fade', duration: DEFAULT_DURATION }))}
        >
          {t('props.transitionJunction')}
        </Button>
      )}
      <p className="text-[11px] text-zinc-500">{t('props.transitionHint')}</p>
    </section>
  );
}
