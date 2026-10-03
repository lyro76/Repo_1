import type { Format } from '@/types';
import { t } from '@/lib/i18n';
import { FORMATS, FORMAT_LIST } from '@/lib/formats';
import { useProjectStore } from '@/store/projectStore';
import { Field, Select, TextInput } from '@/app/ui';

export function ProjectPanel() {
  const project = useProjectStore((s) => s.project);
  const setMeta = useProjectStore((s) => s.setMeta);
  if (!project) return null;
  return (
    <div className="space-y-4 p-4">
      <h3 className="panel-title">{t('props.project')}</h3>
      <Field label={t('props.projectName')}>
        <TextInput
          value={project.name}
          onFocus={() => useProjectStore.getState().beginTransaction()}
          onBlur={() => useProjectStore.getState().endTransaction()}
          onChange={(e) => {
            const name = e.target.value;
            useProjectStore.getState().edit((p) => ({ ...p, name, updatedAt: Date.now() }));
          }}
        />
      </Field>
      <Field label={t('props.projectFormat')}>
        <Select value={project.format} onChange={(e) => setMeta({ format: e.target.value as Format })}>
          {FORMAT_LIST.map((f) => (
            <option key={f} value={f}>
              {t(`format.${f}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('props.projectFps')}>
        <Select value={project.fps} onChange={(e) => setMeta({ fps: Number(e.target.value) })}>
          <option value={30}>30</option>
          <option value={60}>60</option>
        </Select>
      </Field>
      <p className="text-xs text-zinc-500">
        {FORMATS[project.format].width} × {FORMATS[project.format].height}
      </p>
    </div>
  );
}
