import { useEffect, useState, type ReactNode } from 'react';
import type { Clip, TextAlign, TextProps } from '@/types';
import { t } from '@/lib/i18n';
import { FONT_FAMILIES, FONT_LABELS, getTextProps } from '@/lib/text';
import { formatTimecode } from '@/lib/time';
import { findTrack } from '@/lib/timeline/clips';
import { moveClip, setClipDuration, setClipSpeed, SPEEDS, updateClip } from '@/lib/timeline/ops';
import { useProjectStore } from '@/store/projectStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { Button, Field, NumberInput, SegmentedControl, Select, Toggle } from '@/app/ui';
import { deleteSelected, duplicateSelected, splitAtPlayhead } from './actions';
import { TransitionsSection } from './TransitionsSection';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-zinc-800 p-4">
      <h3 className="panel-title">{title}</h3>
      {children}
    </section>
  );
}

/** Gestionnaires pour un champ modifié en continu : une seule entrée d'historique par geste. */
const live = {
  onFocus: () => useProjectStore.getState().beginTransaction(),
  onBlur: () => useProjectStore.getState().endTransaction(),
  onPointerDown: () => useProjectStore.getState().beginTransaction(),
  onPointerUp: () => useProjectStore.getState().endTransaction(),
};

function patchClip(clipId: string, patch: Partial<Clip>) {
  useProjectStore.getState().edit((p) => updateClip(p, clipId, patch));
}

function patchText(clipId: string, patch: Partial<TextProps>) {
  useProjectStore.getState().edit((p) => updateClip(p, clipId, { props: { ...p.clips[clipId]?.props, ...patch } }));
}

/** Champ numérique validé à la sortie du champ ou avec Entrée. */
function CommitNumber({ value, onCommit, step = 0.1, min = 0 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= min) onCommit(parsed);
    else setDraft(value.toFixed(2));
  };
  return (
    <NumberInput
      value={draft}
      step={step}
      min={min}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function TimingSection({ clip, mediaDuration }: { clip: Clip; mediaDuration?: number }) {
  const commit = useProjectStore((s) => s.commit);
  return (
    <Section title={t('props.timing')}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('props.position')}>
          <CommitNumber value={clip.start} onCommit={(v) => commit((p) => moveClip(p, clip.id, v))} />
        </Field>
        <Field label={t('props.duration')}>
          <CommitNumber value={clip.duration} min={0.1} onCommit={(v) => commit((p) => setClipDuration(p, clip.id, v, mediaDuration))} />
        </Field>
      </div>
      {(clip.type === 'video' || clip.type === 'audio') && (
        <p className="text-[11px] text-zinc-500">
          {t('props.inPoint')} : {formatTimecode(clip.inPoint)}
        </p>
      )}
    </Section>
  );
}

function AudioSection({ clip, mediaDuration }: { clip: Clip; mediaDuration?: number }) {
  const commit = useProjectStore((s) => s.commit);
  return (
    <Section title={t('props.audio')}>
      <Field label={`${t('props.volume')} · ${Math.round(clip.volume * 100)} %`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={clip.volume}
          {...live}
          onChange={(e) => patchClip(clip.id, { volume: Number(e.target.value) })}
        />
      </Field>
      <Toggle label={t('props.muted')} checked={clip.muted} onChange={(muted) => commit((p) => updateClip(p, clip.id, { muted }))} />
      <Field group label={t('props.speed')}>
        <SegmentedControl<string>
          value={String(clip.speed)}
          onChange={(v) => commit((p) => setClipSpeed(p, clip.id, Number(v), mediaDuration))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
        />
      </Field>
    </Section>
  );
}

function VisualSection({ clip }: { clip: Clip }) {
  const commit = useProjectStore((s) => s.commit);
  const fit = clip.props?.fit === 'cover' ? 'cover' : 'contain';
  return (
    <Section title={t('props.visual')}>
      <Field group label={t('props.fit')}>
        <SegmentedControl<'contain' | 'cover'>
          value={fit}
          onChange={(value) => commit((p) => updateClip(p, clip.id, { props: { ...clip.props, fit: value } }))}
          options={[
            { value: 'contain', label: t('props.fit.contain') },
            { value: 'cover', label: t('props.fit.cover') },
          ]}
        />
      </Field>
    </Section>
  );
}

function TextSection({ clip }: { clip: Clip }) {
  const props = getTextProps(clip);
  const commit = useProjectStore((s) => s.commit);
  const set = (patch: Partial<TextProps>) => commit((p) => updateClip(p, clip.id, { props: { ...p.clips[clip.id]?.props, ...patch } }));
  return (
    <Section title={t('props.text')}>
      <Field label={t('props.textContent')}>
        <textarea
          rows={3}
          value={props.text}
          placeholder={t('props.textPlaceholder')}
          className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-violet-500"
          onFocus={live.onFocus}
          onBlur={live.onBlur}
          onChange={(e) => patchText(clip.id, { text: e.target.value })}
        />
      </Field>
      <Field label={t('props.font')}>
        <Select value={props.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {FONT_LABELS[font]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${t('props.fontSize')} · ${props.fontSize}`}>
        <input type="range" min={16} max={220} step={1} value={props.fontSize} {...live} onChange={(e) => patchText(clip.id, { fontSize: Number(e.target.value) })} />
      </Field>
      <div className="flex items-center gap-4">
        <Field label={t('props.color')}>
          <input type="color" value={props.color} {...live} onChange={(e) => patchText(clip.id, { color: e.target.value })} />
        </Field>
        <Field label={t('props.strokeColor')}>
          <input type="color" value={props.strokeColor} {...live} onChange={(e) => patchText(clip.id, { strokeColor: e.target.value })} />
        </Field>
      </div>
      <Field label={`${t('props.strokeWidth')} · ${props.strokeWidth}`}>
        <input type="range" min={0} max={20} step={1} value={props.strokeWidth} {...live} onChange={(e) => patchText(clip.id, { strokeWidth: Number(e.target.value) })} />
      </Field>
      <Toggle label={t('props.bold')} checked={props.bold} onChange={(bold) => set({ bold })} />
      <Toggle label={t('props.background')} checked={props.background} onChange={(background) => set({ background })} />
      <Field group label={t('props.align')}>
        <SegmentedControl<TextAlign>
          value={props.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', label: t('props.align.left') },
            { value: 'center', label: t('props.align.center') },
            { value: 'right', label: t('props.align.right') },
          ]}
        />
      </Field>
      <Field label={`${t('props.x')} · ${Math.round(props.x * 100)} %`}>
        <input type="range" min={0} max={1} step={0.01} value={props.x} {...live} onChange={(e) => patchText(clip.id, { x: Number(e.target.value) })} />
      </Field>
      <Field label={`${t('props.y')} · ${Math.round(props.y * 100)} %`}>
        <input type="range" min={0} max={1} step={0.01} value={props.y} {...live} onChange={(e) => patchText(clip.id, { y: Number(e.target.value) })} />
      </Field>
    </Section>
  );
}

export function PropertiesPanel() {
  const selectedId = usePlaybackStore((s) => s.selectedClipId);
  const clip = useProjectStore((s) => (selectedId ? s.project?.clips[selectedId] : undefined));
  const track = useProjectStore((s) => (clip && s.project ? findTrack(s.project, clip.trackId) : undefined));
  const media = useProjectStore((s) => (clip?.mediaId ? s.media[clip.mediaId] : undefined));

  if (!clip) return <div className="p-4 text-sm text-zinc-500">{t('props.noSelection')}</div>;

  const name = clip.type === 'text' ? getTextProps(clip).text : clip.name ?? media?.name ?? '';
  const mediaDuration = media?.kind === 'image' ? undefined : media?.duration;

  return (
    <div className="text-sm">
      <div className="space-y-3 border-b border-zinc-800 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">{t(`props.type.${clip.type}`)}</p>
          <p className="truncate text-sm font-medium text-zinc-100" title={name}>
            {name}
          </p>
          {track && (
            <p className="text-[11px] text-zinc-500">
              {t('props.layer')} : {track.name}
            </p>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" icon="scissors" onClick={() => splitAtPlayhead()} title={t('tools.split')}>
            S
          </Button>
          <Button size="sm" icon="copy" onClick={() => duplicateSelected()} title={t('tools.duplicate')} aria-label={t('tools.duplicate')} />
          <Button size="sm" icon="trash" onClick={() => deleteSelected()} title={t('tools.delete')} aria-label={t('tools.delete')} />
        </div>
      </div>
      <TimingSection clip={clip} mediaDuration={mediaDuration} />
      {clip.type === 'text' && <TextSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'audio') && <AudioSection clip={clip} mediaDuration={mediaDuration} />}
      {(clip.type === 'video' || clip.type === 'image') && <VisualSection clip={clip} />}
      <TransitionsSection clip={clip} />
    </div>
  );
}
