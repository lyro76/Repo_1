import type { Clip, TextProps } from '@/types';
import { t } from './i18n';

export const FONT_FAMILIES = [
  'Inter, system-ui, sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, serif',
  'Impact, "Arial Black", sans-serif',
  '"Courier New", monospace',
  '"Comic Sans MS", cursive',
  '"Trebuchet MS", sans-serif',
] as const;

export const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  'Inter, system-ui, sans-serif': 'Inter',
  'Arial, Helvetica, sans-serif': 'Arial',
  'Georgia, serif': 'Georgia',
  'Impact, "Arial Black", sans-serif': 'Impact',
  '"Courier New", monospace': 'Courier New',
  '"Comic Sans MS", cursive': 'Comic Sans',
  '"Trebuchet MS", sans-serif': 'Trebuchet',
};

export const DEFAULT_TEXT_PROPS: TextProps = {
  text: t('props.textDefault'),
  fontFamily: FONT_FAMILIES[0],
  fontSize: 72,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 4,
  bold: true,
  align: 'center',
  x: 0.5,
  y: 0.5,
  background: false,
};

/** Lit les propriétés texte d'un clip en complétant les valeurs manquantes. */
export function getTextProps(clip: Clip): TextProps {
  const raw = (clip.props ?? {}) as Partial<TextProps>;
  return { ...DEFAULT_TEXT_PROPS, ...raw };
}

export function makeTextProps(patch: Partial<TextProps> = {}): TextProps {
  return { ...DEFAULT_TEXT_PROPS, ...patch };
}
