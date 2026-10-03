import { create } from 'zustand';
import type { Format } from '@/types';
import type { CaptureLayout, PipSettings, ScreenFit, TextPosition } from '@/features/capture/layout';

export type RecState = 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing';

export type CaptureSettings = {
  format: Format;
  layout: CaptureLayout;
  pip: PipSettings;
  screenFit: ScreenFit;
  mirrorWebcam: boolean;
  title: string;
  subtitle: string;
  textColor: string;
  textPosition: TextPosition;
  webcamDeviceId: string;
  micDeviceId: string;
  includeSystemAudio: boolean;
  countdown: boolean;
};

export type DeviceOption = { deviceId: string; label: string };

export type CaptureStore = {
  settings: CaptureSettings;
  webcamOn: boolean;
  screenOn: boolean;
  micOn: boolean;
  micMuted: boolean;
  webcamAspect: number;
  videoDevices: DeviceOption[];
  audioDevices: DeviceOption[];
  recState: RecState;
  countdown: number;
  elapsed: number;
  error: string | null;

  update: (patch: Partial<CaptureSettings>) => void;
  updatePip: (patch: Partial<PipSettings>) => void;
  set: (patch: Partial<Omit<CaptureStore, 'settings' | 'update' | 'updatePip' | 'set'>>) => void;
};

const STORAGE_KEY = 'clipstudio.capture.settings';

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  format: '9:16',
  layout: 'screenPip',
  pip: { x: 0.75, y: 0.85, size: 0.35, shape: 'circle' },
  screenFit: 'contain',
  mirrorWebcam: true,
  title: '',
  subtitle: '',
  textColor: '#ffffff',
  textPosition: 'top',
  webcamDeviceId: '',
  micDeviceId: '',
  includeSystemAudio: true,
  countdown: true,
};

function loadSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CAPTURE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<CaptureSettings>;
    return { ...DEFAULT_CAPTURE_SETTINGS, ...parsed, pip: { ...DEFAULT_CAPTURE_SETTINGS.pip, ...parsed.pip } };
  } catch {
    return DEFAULT_CAPTURE_SETTINGS;
  }
}

function saveSettings(settings: CaptureSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible : on ignore
  }
}

export const useCaptureStore = create<CaptureStore>((set, get) => ({
  settings: typeof localStorage === 'undefined' ? DEFAULT_CAPTURE_SETTINGS : loadSettings(),
  webcamOn: false,
  screenOn: false,
  micOn: false,
  micMuted: false,
  webcamAspect: 16 / 9,
  videoDevices: [],
  audioDevices: [],
  recState: 'idle',
  countdown: 0,
  elapsed: 0,
  error: null,

  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },
  updatePip: (patch) => {
    const settings = { ...get().settings, pip: { ...get().settings.pip, ...patch } };
    saveSettings(settings);
    set({ settings });
  },
  set: (patch) => set(patch),
}));
