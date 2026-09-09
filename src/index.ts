export * from './types.js';
export { bundledPresets, darkPreset, lightPreset } from './presets.js';
export {
  ThemedSvgError,
  cssVariableName,
  discoverLiteralColors,
  exportSvgArtifacts,
  inspectSvg,
  resolvePalette,
  sanitizeSvg,
  transformSvg,
  validateManifest,
  validateSvg,
} from './transform.js';
export {
  processStdioRequest,
  STDIO_PROTOCOL_VERSION,
} from './protocol.js';
export type {
  ExportProtocolRequest,
  InspectProtocolRequest,
  ProtocolOperation,
  ProtocolRequestId,
  ProtocolValidationResult,
  SanitizeProtocolRequest,
  StdioProtocolRequest,
  StdioProtocolResult,
  StdioProtocolResponse,
  TransformProtocolRequest,
  ValidateProtocolRequest,
} from './protocol.js';
export {
  ThemedSvgRuntimeError,
  defineThemedSvgElement,
  hostSvgSource,
  mountThemedSvg,
  upgradeThemedSvgImage,
  upgradeThemedSvgImages,
} from './runtime.js';
export type {
  DefineThemedSvgElementOptions,
  MountThemedSvgOptions,
  ThemedSvgAccessibility,
  ThemedSvgMount,
  ThemedSvgRuntimeErrorCode,
  UpgradeThemedSvgImageOptions,
  UpgradeThemedSvgImagesOptions,
} from './runtime.js';
