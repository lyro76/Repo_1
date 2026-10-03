import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icons';
import { t } from '@/lib/i18n';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'record';
  size?: 'sm' | 'md' | 'icon';
  icon?: IconName;
  active?: boolean;
};

export function Button({ variant = 'default', size = 'md', icon, active, className = '', children, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 no-select';
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    default: 'border border-zinc-700/80 bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700/80',
    primary: 'bg-violet-600 text-white hover:bg-violet-500',
    danger: 'bg-red-600/90 text-white hover:bg-red-500',
    ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
    record: 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/40',
  };
  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'h-7 px-2 text-xs',
    md: 'h-9 px-3 text-sm',
    icon: 'h-8 w-8 text-sm',
  };
  const activeClass = active ? 'ring-1 ring-violet-500 bg-violet-500/15 text-violet-100' : '';
  return (
    <button type="button" className={`${base} ${variants[variant]} ${sizes[size]} ${activeClass} ${className}`} {...rest}>
      {icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-violet-500 ${className}`}
      {...rest}
    />
  );
}

export function NumberInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput type="number" className={`tabular-nums ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300">
      <span>{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? 'bg-violet-600' : 'bg-zinc-700'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
      </span>
    </label>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button size="icon" variant="ghost" onClick={onClose} icon="close" aria-label={t('common.close')} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-700/80 bg-zinc-900 p-0.5">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded-md ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} font-medium transition ${
            option.value === value ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: { id: number; message: string; kind: 'info' | 'success' | 'error' }[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  const colors = {
    info: 'border-zinc-700 bg-zinc-800 text-zinc-100',
    success: 'border-emerald-700/60 bg-emerald-900/70 text-emerald-100',
    error: 'border-red-700/60 bg-red-900/70 text-red-100',
  };
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <button
          type="button"
          key={toast.id}
          onClick={() => onDismiss(toast.id)}
          className={`pointer-events-auto rounded-lg border px-4 py-2 text-sm shadow-xl ${colors[toast.kind]}`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
