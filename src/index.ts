export * from './types.js';
export { bundledPresets, darkPreset, lightPreset } from './presets.js';
export {
  ThemedSvgError,
  cssVariableName,
  discoverLiteralColors,
  resolvePalette,
  transformSvg,
  validateManifest,
} from './transform.js';
export {
  ThemedSvgRuntimeError,
  defineThemedSvgElement,
  mountThemedSvg,
} from './runtime.js';
export type {
  DefineThemedSvgElementOptions,
  MountThemedSvgOptions,
  ThemedSvgAccessibility,
  ThemedSvgMount,
  ThemedSvgRuntimeErrorCode,
} from './runtime.js';
