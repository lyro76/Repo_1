import { t } from '@/lib/i18n';

export function Toolbar() {
  return <div className="flex h-10 shrink-0 items-center border-b border-zinc-800 px-3 text-xs text-zinc-500">{t('timeline.title')}</div>;
}
