import { t } from '@/lib/i18n';
import { Dialog } from '@/app/ui';
import { useUIStore } from '@/store/uiStore';

export function ExportDialog() {
  const setExportOpen = useUIStore((s) => s.setExportOpen);
  return (
    <Dialog title={t('export.title')} onClose={() => setExportOpen(false)}>
      <p className="text-sm text-zinc-400">{t('export.emptyProject')}</p>
    </Dialog>
  );
}
