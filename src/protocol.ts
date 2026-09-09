import {
  exportSvgArtifacts,
  inspectSvg,
  sanitizeSvg,
  transformSvg,
  validateManifest,
  validateSvg,
} from './transform.js';
import type {
  Diagnostic,
  ExportArtifactOptions,
  Palette,
  SvgInspectionResult,
  SvgMetadata,
  SvgSanitizeResult,
  ThemedSvgManifest,
  TransformOptions,
  TransformResult,
  ExportArtifactsResult,
} from './types.js';

export const STDIO_PROTOCOL_VERSION = 1 as const;

export type ProtocolRequestId = string | number | null;
export type ProtocolOperation = 'inspect' | 'validate' | 'transform' | 'sanitize' | 'export';

interface ProtocolRequestBase {
  protocolVersion: typeof STDIO_PROTOCOL_VERSION;
  id?: ProtocolRequestId;
  operation: ProtocolOperation;
}

export interface InspectProtocolRequest extends ProtocolRequestBase {
  operation: 'inspect';
  svg: string;
}

export interface ValidateProtocolRequest extends ProtocolRequestBase {
  operation: 'validate';
  svg?: string;
  manifest?: ThemedSvgManifest;
}

export interface TransformProtocolRequest extends ProtocolRequestBase {
  operation: 'transform';
  svg: string;
  manifest: ThemedSvgManifest;
  options?: TransformOptions;
}

export interface SanitizeProtocolRequest extends ProtocolRequestBase {
  operation: 'sanitize';
  svg: string;
}

export interface ExportProtocolRequest extends ProtocolRequestBase {
  operation: 'export';
  svg: string;
  manifest: ThemedSvgManifest;
  options?: ExportArtifactOptions;
}

export type StdioProtocolRequest =
  | InspectProtocolRequest
  | ValidateProtocolRequest
  | TransformProtocolRequest
  | SanitizeProtocolRequest
  | ExportProtocolRequest;

export interface ProtocolValidationResult {
  valid: boolean;
}

export type StdioProtocolResult =
  | SvgInspectionResult
  | ProtocolValidationResult
  | TransformResult
  | SvgSanitizeResult
  | ExportArtifactsResult;

export interface StdioProtocolResponse<Result = StdioProtocolResult> {
  protocolVersion: typeof STDIO_PROTOCOL_VERSION;
  id?: ProtocolRequestId;
  operation?: ProtocolOperation;
  ok: boolean;
  result?: Result;
  diagnostics: Diagnostic[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnostic(message: string, path = ''): Diagnostic {
  return {
    code: 'invalid-request',
    severity: 'error',
    message,
    source: { kind: 'request', ...(path ? { path } : {}) },
  };
}

function palette(value: unknown): value is Palette {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function manifest(value: unknown): value is ThemedSvgManifest {
  if (!isObject(value)) return false;
  if (
    typeof value.schemaVersion !== 'number'
    || typeof value.namespace !== 'string'
    || typeof value.defaultPreset !== 'string'
    || !Array.isArray(value.tokens)
    || !isObject(value.presets)
    || !Array.isArray(value.bindings)
  ) return false;
  if (!value.tokens.every(
    (token) => isObject(token)
      && typeof token.id === 'string'
      && (token.description === undefined || typeof token.description === 'string')
  )) return false;
  if (!Object.values(value.presets).every(palette)) return false;
  if (
    value.paletteOverrides !== undefined
    && (
      !isObject(value.paletteOverrides)
      || (value.paletteOverrides.light !== undefined && !palette(value.paletteOverrides.light))
      || (value.paletteOverrides.dark !== undefined && !palette(value.paletteOverrides.dark))
    )
  ) return false;
  return value.bindings.every((binding) => {
    if (
      !isObject(binding)
      || typeof binding.kind !== 'string'
      || typeof binding.token !== 'string'
      || typeof binding.selector !== 'string'
    ) return false;
    if (binding.kind === 'gradient-stop') return true;
    if (binding.kind === 'presentation') return typeof binding.attribute === 'string';
    if (binding.kind === 'inline-style') return typeof binding.property === 'string';
    return binding.kind === 'stylesheet'
      && typeof binding.property === 'string'
      && (binding.styleSelector === undefined || typeof binding.styleSelector === 'string');
  });
}

function metadata(value: unknown): value is SvgMetadata {
  return isObject(value)
    && (value.role === undefined || typeof value.role === 'string')
    && (value.title === undefined || typeof value.title === 'string')
    && (value.description === undefined || typeof value.description === 'string');
}

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function transformOptions(value: unknown, allowModes: boolean): value is ExportArtifactOptions {
  if (!isObject(value)) return false;
  const common = ['preset', 'palette', 'lightPalette', 'darkPalette', 'metadata'];
  if (!hasOnlyKeys(value, [...common, allowModes ? 'modes' : 'mode'])) return false;
  if (
    (value.preset !== undefined && typeof value.preset !== 'string')
    || (value.palette !== undefined && !palette(value.palette))
    || (value.lightPalette !== undefined && !palette(value.lightPalette))
    || (value.darkPalette !== undefined && !palette(value.darkPalette))
    || (value.metadata !== undefined && !metadata(value.metadata))
  ) return false;
  if (allowModes) {
    return value.modes === undefined
      || (
        Array.isArray(value.modes)
        && value.modes.every((mode) =>
          ['standalone-adaptive', 'host', 'fixed', 'paired-fixed'].includes(String(mode))
        )
      );
  }
  return value.mode === undefined
    || ['standalone-adaptive', 'host', 'fixed', 'paired-fixed'].includes(String(value.mode));
}

function responseBase(input: JsonObject): Pick<StdioProtocolResponse, 'protocolVersion' | 'id'> {
  const id = input.id;
  return {
    protocolVersion: STDIO_PROTOCOL_VERSION,
    ...(typeof id === 'string' || typeof id === 'number' || id === null ? { id } : {}),
  };
}

function invalid(input: JsonObject, message: string, path = ''): StdioProtocolResponse {
  return {
    ...responseBase(input),
    ok: false,
    diagnostics: [diagnostic(message, path)],
  };
}

export function processStdioRequest(input: unknown): StdioProtocolResponse {
  if (!isObject(input)) return invalid({}, 'Request must be a JSON object.');
  if (
    input.id !== undefined
    && typeof input.id !== 'string'
    && typeof input.id !== 'number'
    && input.id !== null
  ) {
    return invalid(input, '"id" must be a string, number, or null.', '/id');
  }
  if (input.protocolVersion !== STDIO_PROTOCOL_VERSION) {
    return invalid(input, `Unsupported protocolVersion; expected ${STDIO_PROTOCOL_VERSION}.`, '/protocolVersion');
  }
  const operations: ProtocolOperation[] = ['inspect', 'validate', 'transform', 'sanitize', 'export'];
  if (typeof input.operation !== 'string' || !operations.includes(input.operation as ProtocolOperation)) {
    return invalid(input, 'Unknown or missing operation.', '/operation');
  }
  const operation = input.operation as ProtocolOperation;
  const operationKeys: Record<ProtocolOperation, string[]> = {
    inspect: ['protocolVersion', 'id', 'operation', 'svg'],
    validate: ['protocolVersion', 'id', 'operation', 'svg', 'manifest'],
    transform: ['protocolVersion', 'id', 'operation', 'svg', 'manifest', 'options'],
    sanitize: ['protocolVersion', 'id', 'operation', 'svg'],
    export: ['protocolVersion', 'id', 'operation', 'svg', 'manifest', 'options'],
  };
  const unknownKey = Object.keys(input).find((key) => !operationKeys[operation].includes(key));
  if (unknownKey) return invalid(input, `Unknown request property "${unknownKey}".`, `/${unknownKey}`);
  const base = { ...responseBase(input), operation };

  if (operation === 'inspect' || operation === 'sanitize') {
    if (typeof input.svg !== 'string') return invalid(input, `${operation} requires string "svg".`, '/svg');
    const output = operation === 'inspect' ? inspectSvg(input.svg) : sanitizeSvg(input.svg);
    return {
      ...base,
      ok: !output.diagnostics.some(({ severity }) => severity === 'error'),
      result: output,
      diagnostics: output.diagnostics,
    };
  }

  if (operation === 'validate') {
    if (input.svg === undefined && input.manifest === undefined) {
      return invalid(input, 'validate requires "svg", "manifest", or both.');
    }
    const diagnostics: Diagnostic[] = [];
    if (input.svg !== undefined && typeof input.svg !== 'string') {
      return invalid(input, '"svg" must be a string.', '/svg');
    }
    const validManifest = input.manifest === undefined ? undefined : manifest(input.manifest);
    if (validManifest === false) {
      diagnostics.push(diagnostic('"manifest" does not match the version 1 manifest shape.', '/manifest'));
    }
    if (typeof input.svg === 'string' && validManifest === true) {
      diagnostics.push(...transformSvg(input.svg, input.manifest as ThemedSvgManifest).diagnostics);
    } else {
      if (typeof input.svg === 'string') diagnostics.push(...validateSvg(input.svg).diagnostics);
      if (validManifest === true) {
        diagnostics.push(...validateManifest(input.manifest as ThemedSvgManifest));
      }
    }
    return {
      ...base,
      ok: !diagnostics.some(({ severity }) => severity === 'error'),
      result: { valid: !diagnostics.some(({ severity }) => severity === 'error') },
      diagnostics,
    };
  }

  if (typeof input.svg !== 'string') return invalid(input, `${operation} requires string "svg".`, '/svg');
  if (!manifest(input.manifest)) {
    return invalid(input, `${operation} requires a version 1 "manifest".`, '/manifest');
  }
  if (input.options !== undefined && !transformOptions(input.options, operation === 'export')) {
    return invalid(input, `Invalid ${operation} options.`, '/options');
  }
  const output = operation === 'transform'
    ? transformSvg(input.svg, input.manifest, input.options as TransformOptions | undefined)
    : exportSvgArtifacts(input.svg, input.manifest, input.options as ExportArtifactOptions | undefined);
  return {
    ...base,
    ok: !output.diagnostics.some(({ severity }) => severity === 'error'),
    result: output,
    diagnostics: output.diagnostics,
  };
}
