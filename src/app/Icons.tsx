import type { SVGProps } from 'react';

const paths = {
  clapper: 'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm0-4h16v4H4V4Zm4 0 2 4m2-4 2 4m2-4 2 4',
  film: 'M4 5h16v14H4V5Zm0 4h16M4 15h16M8 5v14m8-14v14',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Zm9.5-13.5 3 3',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  back: 'M15 6l-6 6 6 6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h3',
  export: 'M12 3v12m0-12 4 4m-4-4-4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  play: 'M7 5v14l12-7z',
  pause: 'M7 5h4v14H7zm6 0h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  record: 'M12 12m-6 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0',
  skipBack: 'M6 5v14M19 5l-10 7 10 7z',
  skipForward: 'M18 5v14M5 5l10 7-10 7z',
  scissors: 'M6 6m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M6 18m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M8.1 7.9 20 20M8.1 16.1 20 4',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  text: 'M5 5h14M12 5v14M9 19h6',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  video: 'M4 7h11v10H4zM15 10l5-3v10l-5-3z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 15m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  screen: 'M3 5h18v11H3zM8 20h8m-4-4v4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3m-4 0h8',
  micOff: 'M4 4l16 16M9 9v3a3 3 0 0 0 5 2.2M15 6a3 3 0 0 0-6 0v1M6 12a6 6 0 0 0 9.5 4.9M18 12a6 6 0 0 1-.6 2.6M12 18v3m-4 0h8',
  volume: 'M4 10v4h4l5 4V6l-5 4H4Zm11-1a3 3 0 0 1 0 6m2.5-9a7 7 0 0 1 0 12',
  volumeOff: 'M4 10v4h4l5 4V6l-5 4H4Zm12 0 4 4m0-4-4 4',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5L20 7',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4M6 4h4v8a2 2 0 0 0 4 0V4h4',
  zoomIn: 'M10 10m-6 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0M20 20l-5.5-5.5M10 7v6m-3-3h6',
  zoomOut: 'M10 10m-6 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0M20 20l-5.5-5.5M7 10h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  upload: 'M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12m0 0 4-4m-4 4-4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  settings: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1',
  layers: 'M12 4 3 9l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 17l9 5 9-5',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 11v5m0-8h.01',
  warning: 'M12 4 2 20h20L12 4Zm0 6v4m0 3h.01',
  chevronDown: 'm6 9 6 6 6-6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 0m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  eyeOff: 'M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-2.4 3.2',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'h-4 w-4', ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'record' ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} fill={name === 'record' || name === 'play' ? 'currentColor' : 'none'} />
    </svg>
  );
}
