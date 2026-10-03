import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { HomeScreen } from '@/features/projects/HomeScreen';
import { startAutosave } from '@/features/projects/persistence';
import { EditorLayout } from './EditorLayout';
import { Toasts } from './ui';

export function App() {
  const screen = useUIStore((s) => s.screen);
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismiss);

  useEffect(() => startAutosave(), []);

  return (
    <>
      {screen === 'home' ? <HomeScreen /> : <EditorLayout />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
