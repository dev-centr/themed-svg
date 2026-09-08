export const COMMON_TOKEN_IDS = [
  'color.canvas',
  'color.surface.primary',
  'color.surface.secondary',
  'color.text.primary',
  'color.text.muted',
  'color.border.primary',
  'color.edge',
  'color.edge.label',
  'color.accent.primary',
  'color.accent.on-primary',
  'color.status.success',
  'color.status.warning',
  'color.status.danger',
] as const;

export type CommonTokenId = (typeof COMMON_TOKEN_IDS)[number];
export type SemanticTokenId = CommonTokenId | (string & {});
export type Palette = Record<string, string>;
export type PaletteMode = 'light' | 'dark';

export interface SourceProvenance {
  kind: string;
  uri?: string;
  generator?: string;
  generatedAt?: string;
}

export interface SemanticTokenDefinition {
  id: SemanticTokenId;
  description?: string;
}

export interface FallbackBehavior {
  unresolvedToken?: 'error' | 'preserve';
  missingTarget?: 'error' | 'warn';
}

interface BindingBase {
  token: SemanticTokenId;
  selector: string;
}

export interface PresentationBinding extends BindingBase {
  kind: 'presentation';
  attribute: 'fill' | 'stroke' | 'color' | 'stop-color' | 'flood-color' | 'lighting-color';
}

export interface InlineStyleBinding extends BindingBase {
  kind: 'inline-style';
  property: string;
}

export interface StylesheetBinding extends BindingBase {
  kind: 'stylesheet';
  property: string;
  styleSelector?: string;
}

export interface GradientStopBinding extends BindingBase {
  kind: 'gradient-stop';
}

export type SvgBinding =
  | PresentationBinding
  | InlineStyleBinding
  | StylesheetBinding
  | GradientStopBinding;

export interface ThemedSvgManifest {
  schemaVersion: 1;
  namespace: string;
  source?: SourceProvenance;
  tokens: SemanticTokenDefinition[];
  defaultPreset: string;
  presets: Record<string, Palette>;
  paletteOverrides?: Partial<Record<PaletteMode, Palette>>;
  bindings: SvgBinding[];
  fallback?: FallbackBehavior;
}

export type OutputMode = 'fixed' | 'standalone-adaptive' | 'host' | 'paired-fixed';

export interface SvgMetadata {
  role?: string;
  title?: string;
  description?: string;
}

export interface TransformOptions {
  mode?: OutputMode;
  preset?: string;
  palette?: Palette;
  lightPalette?: Palette;
  darkPalette?: Palette;
  metadata?: SvgMetadata;
}

export type DiagnosticCode =
  | 'unsafe-construct'
  | 'unsupported-construct'
  | 'invalid-palette'
  | 'missing-selector'
  | 'missing-property'
  | 'missing-viewbox'
  | 'unresolved-token'
  | 'binding-collision'
  | 'invalid-manifest'
  | 'invalid-svg';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  bindingIndex?: number;
}

export interface TransformResult {
  svg?: string;
  lightSvg?: string;
  darkSvg?: string;
  diagnostics: Diagnostic[];
}

export interface LiteralColorOccurrence {
  value: string;
  selector: string;
  property: string;
}
