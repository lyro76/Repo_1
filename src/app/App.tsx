import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useCaptureStore } from '@/store/captureStore';
import { HomeScreen } from '@/features/projects/HomeScreen';
import { startAutosave } from '@/features/projects/persistence';
import { EditorLayout } from './EditorLayout';
import { Toasts } from './ui';

export function App() {
  const screen = useUIStore((s) => s.screen);
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismiss);

  useEffect(() => startAutosave(), []);

  // Demande un stockage persistant pour que le navigateur n'efface pas les projets.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  // Avertit avant de fermer l'onglet pendant un enregistrement ou un export.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const busy = useCaptureStore.getState().recState !== 'idle' || useUIStore.getState().exporting;
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <>
      {screen === 'home' ? <HomeScreen /> : <EditorLayout />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
