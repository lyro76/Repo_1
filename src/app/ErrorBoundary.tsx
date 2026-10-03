import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/lib/i18n';

type State = { error: Error | null };

/** Affiche l'erreur au lieu d'une page vide si l'interface plante. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <div className="max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="mb-2 text-lg font-semibold">{t('error.title')}</h1>
          <p className="mb-4 text-sm text-zinc-400">{t('error.description')}</p>
          <pre className="mb-4 max-h-40 overflow-auto rounded bg-zinc-950 p-3 text-xs text-red-300">{error.message}</pre>
          <button type="button" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500" onClick={() => window.location.reload()}>
            {t('error.reload')}
          </button>
        </div>
      </div>
    );
  }
}
