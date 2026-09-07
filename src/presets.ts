import type { Palette } from './types.js';

export const lightPreset: Readonly<Palette> = {
  'color.canvas': '#ffffff',
  'color.surface.primary': '#f8fafc',
  'color.surface.secondary': '#e2e8f0',
  'color.text.primary': '#0f172a',
  'color.text.muted': '#64748b',
  'color.border.primary': '#94a3b8',
  'color.edge': '#475569',
  'color.edge.label': '#334155',
  'color.accent.primary': '#2563eb',
  'color.accent.on-primary': '#ffffff',
  'color.status.success': '#15803d',
  'color.status.warning': '#a16207',
  'color.status.danger': '#b91c1c',
};

export const darkPreset: Readonly<Palette> = {
  'color.canvas': '#0f172a',
  'color.surface.primary': '#1e293b',
  'color.surface.secondary': '#334155',
  'color.text.primary': '#f8fafc',
  'color.text.muted': '#94a3b8',
  'color.border.primary': '#64748b',
  'color.edge': '#cbd5e1',
  'color.edge.label': '#e2e8f0',
  'color.accent.primary': '#60a5fa',
  'color.accent.on-primary': '#0f172a',
  'color.status.success': '#4ade80',
  'color.status.warning': '#facc15',
  'color.status.danger': '#f87171',
};

export const bundledPresets = {
  light: lightPreset,
  dark: darkPreset,
} as const;
