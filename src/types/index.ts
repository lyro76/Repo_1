// Modèle de données de ClipStudio.

export type Format = '9:16' | '1:1' | '16:9';
export type ClipType = 'video' | 'audio' | 'text' | 'image';
export type TrackType = 'video' | 'audio' | 'text';
export type MediaKind = 'video' | 'audio' | 'image';

export type TransitionType = 'none' | 'fade' | 'fadeBlack';

export type Transition = {
  type: TransitionType;
  /** Durée de la transition en secondes. */
  duration: number;
};

export type Clip = {
  id: string;
  trackId: string;
  mediaId?: string;
  type: ClipType;
  /** Position sur la timeline (s). */
  start: number;
  /** Début dans le média source (s). */
  inPoint: number;
  /** Durée affichée sur la timeline (s). */
  duration: number;
  speed: number;
  volume: number;
  muted: boolean;
  name?: string;
  transitionIn?: Transition;
  transitionOut?: Transition;
  /** Texte, position, style... */
  props?: Record<string, unknown>;
};

export type Track = {
  id: string;
  type: TrackType;
  name: string;
  clipIds: string[];
  muted: boolean;
};

export type Project = {
  id: string;
  name: string;
  format: Format;
  fps: number;
  tracks: Track[];
  clips: Record<string, Clip>;
  createdAt: number;
  updatedAt: number;
};

export type MediaAsset = {
  id: string;
  projectId: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  /** Durée du média (s) — 0 pour une image. */
  duration: number;
  width?: number;
  height?: number;
  size: number;
  hasAudio: boolean;
  createdAt: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  format: Format;
  fps: number;
  createdAt: number;
  updatedAt: number;
  clipCount: number;
};

export type TextAlign = 'left' | 'center' | 'right';

/** Propriétés typées d'un clip texte (stockées dans `clip.props`). */
export type TextProps = {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  bold: boolean;
  align: TextAlign;
  /** Position du centre du texte, normalisée (0..1). */
  x: number;
  y: number;
  /** Fond semi-transparent derrière le texte. */
  background: boolean;
};
