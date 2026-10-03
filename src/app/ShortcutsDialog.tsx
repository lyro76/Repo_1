import { t } from '@/lib/i18n';
import { Dialog } from './ui';

const rows: { keys: string; label: string }[] = [
  { keys: 'Espace', label: t('shortcuts.space') },
  { keys: 'S', label: t('shortcuts.s') },
  { keys: 'Suppr / Retour', label: t('shortcuts.delete') },
  { keys: 'Ctrl + Z', label: t('shortcuts.ctrlZ') },
  { keys: 'Ctrl + Y', label: t('shortcuts.ctrlY') },
  { keys: 'Ctrl + D', label: t('shortcuts.ctrlD') },
  { keys: '← / →', label: t('shortcuts.arrows') },
  { keys: 'Début / Fin', label: t('shortcuts.home') },
  { keys: 'Ctrl + molette', label: t('shortcuts.ctrlWheel') },
  { keys: 'R', label: t('shortcuts.r') },
  { keys: 'P', label: t('shortcuts.p') },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('shortcuts.title')} onClose={onClose}>
      <ul className="divide-y divide-zinc-800 text-sm">
        {rows.map((row) => (
          <li key={row.keys} className="flex items-center justify-between py-2">
            <span className="text-zinc-300">{row.label}</span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-200">{row.keys}</kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
