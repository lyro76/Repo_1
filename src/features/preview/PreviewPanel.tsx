import { t } from '@/lib/i18n';

export function PreviewPanel({ active }: { active: boolean }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500" data-active={active}>
      {t('preview.empty')}
    </div>
  );
}
