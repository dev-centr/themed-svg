import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import colorNames from 'color-name';
import postcss, { type Declaration, type Rule } from 'postcss';
import valueParser from 'postcss-value-parser';
import { SaxesParser } from 'saxes';
import { bundledPresets } from './presets.js';
import type {
  Diagnostic,
  LiteralColorOccurrence,
  OutputMode,
  Palette,
  PaletteMode,
  SvgBinding,
  ThemedSvgManifest,
  TransformOptions,
  TransformResult,
} from './types.js';

type XmlElement = any;
type XmlDocument = any;

const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;
const SAFE_HREF = /^(?:#|data:image\/(?:png|gif|jpeg|webp);base64,)/i;
const NUMERIC_DIMENSION = /^\s*(?:\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i;
const SMIL_MUTATION_TAGS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
]);
const HEX_COLOR = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i;
const NUMERIC_COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*[0-9.+,%/\s-]*(?:(?:deg|grad|rad|turn)[0-9.+,%/\s-]*)?\)$/i;
const COLOR_SPACE_FUNCTION = /^color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\s+[0-9.+%/\s-]+\)$/i;

export class ThemedSvgError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: Diagnostic[]
  ) {
    super(message);
    this.name = 'ThemedSvgError';
  }
}

function kebabRole(role: string): string {
  return role.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

export function cssVariableName(namespace: string, token: string): string {
  return `--themed-svg-${namespace}-${kebabRole(token)}`;
}

export function validateManifest(manifest: ThemedSvgManifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (manifest.schemaVersion !== 1) {
    diagnostics.push({
      code: 'invalid-manifest',
      severity: 'error',
      message: 'Unsupported manifest schemaVersion; expected 1.',
    });
  }
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.namespace ?? '')) {
    diagnostics.push({
      code: 'invalid-manifest',
      severity: 'error',
      message: 'Manifest namespace must be kebab-case.',
    });
  }
  const ids = new Set<string>();
  for (const token of manifest.tokens ?? []) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(token.id)) {
      diagnostics.push({
        code: 'invalid-manifest',
        severity: 'error',
        message: `Invalid semantic token ID: ${token.id}`,
      });
    }
    if (ids.has(token.id)) {
      diagnostics.push({
        code: 'invalid-manifest',
        severity: 'error',
        message: `Duplicate semantic token ID: ${token.id}`,
      });
    }
    ids.add(token.id);
  }
  if (!manifest.presets?.[manifest.defaultPreset]) {
    diagnostics.push({
      code: 'invalid-manifest',
      severity: 'error',
      message: `Default preset "${manifest.defaultPreset}" does not exist.`,
    });
  }
  for (const [index, binding] of (manifest.bindings ?? []).entries()) {
    if (!ids.has(binding.token)) {
      diagnostics.push({
        code: 'invalid-manifest',
        severity: 'error',
        message: `Binding ${index} refers to undeclared token "${binding.token}".`,
        bindingIndex: index,
      });
    }
  }
  return diagnostics;
}

function validateXml(svg: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    diagnostics.push({
      code: 'unsafe-construct',
      severity: 'error',
      message: 'DOCTYPE declarations are forbidden.',
    });
  });
  parser.on('error', (error: Error) => {
    diagnostics.push({ code: 'invalid-svg', severity: 'error', message: error.message });
  });
  try {
    parser.write(svg).close();
  } catch (error) {
    diagnostics.push({
      code: 'invalid-svg',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return diagnostics;
}

function elements(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (node: any): void => {
    if (node?.nodeType === 1) result.push(node);
    for (let child = node?.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(root);
  return result;
}

function matchesSimple(element: XmlElement, selector: string): boolean {
  const attributes = [...selector.matchAll(/\[([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)];
  const plain = selector.replace(/\[[^\]]+\]/g, '');
  const id = plain.match(/#([\w:-]+)/)?.[1];
  const classes = [...plain.matchAll(/\.([\w:-]+)/g)].map((match) => match[1]!);
  const tag = plain.match(/^[a-zA-Z][\w:-]*/)?.[0];
  if (tag && String(element.tagName).toLowerCase() !== tag.toLowerCase()) return false;
  if (id && element.getAttribute('id') !== id) return false;
  const actualClasses = new Set((element.getAttribute('class') ?? '').split(/\s+/));
  if (classes.some((name) => !actualClasses.has(name))) return false;
  return attributes.every((attribute) => {
    const actual = element.getAttribute(attribute[1]!);
    const expected = attribute[2] ?? attribute[3] ?? attribute[4];
    return expected === undefined ? actual !== null : actual === expected.trim();
  });
}

function query(root: XmlElement, selector: string): XmlElement[] {
  const groups = selector.split(',').map((value) => value.trim()).filter(Boolean);
  const all = elements(root);
  const found = new Set<XmlElement>();
  for (const group of groups) {
    const chain = group.split(/\s+|>/).filter(Boolean);
    for (const element of all) {
      if (!matchesSimple(element, chain.at(-1)!)) continue;
      let ancestor = element.parentNode;
      let index = chain.length - 2;
      while (index >= 0 && ancestor) {
        if (ancestor.nodeType === 1 && matchesSimple(ancestor, chain[index]!)) index--;
        ancestor = ancestor.parentNode;
      }
      if (index < 0) found.add(element);
    }
  }
  return [...found];
}

function supportedSelector(selector: string): boolean {
  return selector.length > 0
    && !/[+~:()]/.test(selector)
    && !/\[[^\]]*\s[^\]]*\]/.test(selector);
}

function inspectCss(css: string, context: string, diagnostics: Diagnostic[]): void {
  try {
    const root = postcss.parse(css);
    root.walkAtRules('import', () => {
      diagnostics.push({
        code: 'unsafe-construct',
        severity: 'error',
        message: `CSS @import is forbidden in ${context}.`,
      });
    });
    root.walkDecls((declaration) => {
      if (/(?:expression\s*\(|(?:^|[;\s])behavior\s*:|-moz-binding\s*:)/i.test(
        `${declaration.prop}:${declaration.value}`
      )) {
        diagnostics.push({
          code: 'unsafe-construct',
          severity: 'error',
          message: `Active CSS is forbidden in ${context}.`,
        });
      }
      valueParser(declaration.value).walk((node) => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
        const target = valueParser.stringify(node.nodes).trim().replace(/^['"]|['"]$/g, '');
        if (!target.startsWith('#') && !SAFE_HREF.test(target)) {
          diagnostics.push({
            code: 'unsafe-construct',
            severity: 'error',
            message: `External CSS resource "${target}" is forbidden in ${context}.`,
          });
        }
      });
    });
  } catch (error) {
    diagnostics.push({
      code: 'invalid-svg',
      severity: 'error',
      message: `Invalid CSS in ${context}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function safetyDiagnostics(document: XmlDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const element of elements(document.documentElement)) {
    const tag = String(element.tagName).toLowerCase();
    if (tag === 'script' || tag === 'foreignobject' || SMIL_MUTATION_TAGS.has(tag)) {
      diagnostics.push({
        code: 'unsafe-construct',
        severity: 'error',
        message: `<${element.tagName}> is forbidden.`,
      });
    }
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index);
      if (!attribute) continue;
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) {
        diagnostics.push({
          code: 'unsafe-construct',
          severity: 'error',
          message: `Event handler attribute ${attribute.name} is forbidden.`,
        });
      }
      if ((name === 'href' || name === 'xlink:href') && !SAFE_HREF.test(value)) {
        diagnostics.push({
          code: 'unsafe-construct',
          severity: 'error',
          message: `External or unsafe href "${value}" is forbidden.`,
        });
      }
    }
    if (tag === 'style') inspectCss(element.textContent ?? '', '<style>', diagnostics);
    const style = element.getAttribute('style');
    if (style) inspectCss(`x{${style}}`, `style attribute on <${element.tagName}>`, diagnostics);
  }
  return diagnostics;
}

function validatePalette(palette: Palette, context: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [token, rawValue] of Object.entries(palette)) {
    const value = rawValue.trim();
    const namedColor = value.toLowerCase();
    if (
      !HEX_COLOR.test(value)
      && !NUMERIC_COLOR_FUNCTION.test(value)
      && !COLOR_SPACE_FUNCTION.test(value)
      && namedColor !== 'transparent'
      && !(namedColor in colorNames)
    ) {
      diagnostics.push({
        code: 'invalid-palette',
        severity: 'error',
        message: `Palette value for "${token}" in ${context} is not a concrete CSS color.`,
      });
      continue;
    }
  }
  return diagnostics;
}

function parseSvg(svg: string): { document?: XmlDocument; diagnostics: Diagnostic[] } {
  const diagnostics = validateXml(svg);
  if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics };
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (String(document.documentElement?.tagName).toLowerCase() !== 'svg') {
    diagnostics.push({
      code: 'invalid-svg',
      severity: 'error',
      message: 'Document root must be <svg>.',
    });
  }
  diagnostics.push(...safetyDiagnostics(document));
  return { document, diagnostics };
}

function runtimeModePalette(options: TransformOptions, mode: PaletteMode): Palette | undefined {
  return mode === 'light' ? options.lightPalette : options.darkPalette;
}

export function resolvePalette(
  manifest: ThemedSvgManifest,
  preset: string,
  mode: PaletteMode,
  options: Pick<TransformOptions, 'palette' | 'lightPalette' | 'darkPalette'> = {}
): Palette {
  return {
    ...bundledPresets[mode],
    ...(manifest.presets[preset] ?? {}),
    ...(manifest.paletteOverrides?.[mode] ?? {}),
    ...(options.palette ?? {}),
    ...(runtimeModePalette(options, mode) ?? {}),
  };
}

function replacement(
  outputMode: 'fixed' | 'standalone-adaptive' | 'host',
  manifest: ThemedSvgManifest,
  token: string,
  palette: Palette
): string | undefined {
  const fallback = palette[token];
  if (!fallback) return undefined;
  return outputMode === 'fixed'
    ? fallback
    : `var(${cssVariableName(manifest.namespace, token)}, ${fallback})`;
}

function setStyleProperty(element: XmlElement, property: string, value: string): boolean {
  const root = postcss.parse(`x{${element.getAttribute('style') ?? ''}}`);
  const rule = root.first as Rule;
  let declaration: Declaration | undefined;
  rule.walkDecls(property, (candidate) => {
    declaration ??= candidate;
  });
  if (!declaration) return false;
  declaration.value = value;
  element.setAttribute(
    'style',
    rule.nodes?.map((node) => node.toString().replace(/;?$/, ';')).join(' ') ?? ''
  );
  return true;
}

function applyStylesheetBinding(
  document: XmlDocument,
  binding: Extract<SvgBinding, { kind: 'stylesheet' }>,
  value: string
): { matched: boolean; property: boolean } {
  const styleElements = query(document.documentElement, binding.styleSelector ?? 'style');
  let matched = false;
  let property = false;
  for (const styleElement of styleElements) {
    const root = postcss.parse(styleElement.textContent ?? '');
    root.walkRules((rule) => {
      if (!rule.selectors.some((selector) => selector.trim() === binding.selector.trim())) return;
      matched = true;
      rule.walkDecls(binding.property, (declaration) => {
        declaration.value = value;
        property = true;
      });
    });
    while (styleElement.firstChild) styleElement.removeChild(styleElement.firstChild);
    styleElement.appendChild(document.createTextNode(root.toString()));
  }
  return { matched, property };
}

function bindingTarget(binding: SvgBinding): string {
  if (binding.kind === 'presentation') return binding.attribute;
  if (binding.kind === 'gradient-stop') return 'stop-color';
  return binding.property;
}

function applyBindings(
  document: XmlDocument,
  manifest: ThemedSvgManifest,
  outputMode: 'fixed' | 'standalone-adaptive' | 'host',
  palette: Palette,
  diagnostics: Diagnostic[]
): void {
  const targets = new Map<string, number>();
  manifest.bindings.forEach((binding, bindingIndex) => {
    const value = replacement(outputMode, manifest, binding.token, palette);
    if (!value) {
      diagnostics.push({
        code: 'unresolved-token',
        severity: manifest.fallback?.unresolvedToken === 'preserve' ? 'warning' : 'error',
        message: `No value resolved for token "${binding.token}".`,
        bindingIndex,
      });
      return;
    }
    const key = `${binding.kind}:${binding.selector}:${bindingTarget(binding)}`;
    const previous = targets.get(key);
    if (previous !== undefined) {
      diagnostics.push({
        code: 'binding-collision',
        severity: 'warning',
        message: `Binding ${bindingIndex} collides with binding ${previous}; later binding wins.`,
        bindingIndex,
      });
    }
    targets.set(key, bindingIndex);

    if (binding.kind === 'stylesheet') {
      if (binding.styleSelector && !supportedSelector(binding.styleSelector)) {
        diagnostics.push({
          code: 'unsupported-construct',
          severity: 'error',
          message: `Unsupported style element selector "${binding.styleSelector}".`,
          bindingIndex,
        });
        return;
      }
      const result = applyStylesheetBinding(document, binding, value);
      if (!result.matched || !result.property) {
        diagnostics.push({
          code: result.matched ? 'missing-property' : 'missing-selector',
          severity: manifest.fallback?.missingTarget === 'error' ? 'error' : 'warning',
          message: result.matched
            ? `Stylesheet selector "${binding.selector}" has no "${binding.property}" declaration.`
            : `Stylesheet selector "${binding.selector}" was not found.`,
          bindingIndex,
        });
      }
      return;
    }

    if (!supportedSelector(binding.selector)) {
      diagnostics.push({
        code: 'unsupported-construct',
        severity: 'error',
        message: `Unsupported element selector "${binding.selector}".`,
        bindingIndex,
      });
      return;
    }
    const matched = query(document.documentElement, binding.selector);
    if (matched.length === 0) {
      diagnostics.push({
        code: 'missing-selector',
        severity: manifest.fallback?.missingTarget === 'error' ? 'error' : 'warning',
        message: `Selector "${binding.selector}" was not found.`,
        bindingIndex,
      });
      return;
    }
    for (const element of matched) {
      if (binding.kind === 'inline-style') {
        if (!setStyleProperty(element, binding.property, value)) {
          diagnostics.push({
            code: 'missing-property',
            severity: manifest.fallback?.missingTarget === 'error' ? 'error' : 'warning',
            message: `Selector "${binding.selector}" has no inline "${binding.property}" declaration.`,
            bindingIndex,
          });
        }
      } else {
        element.setAttribute(
          binding.kind === 'gradient-stop' ? 'stop-color' : binding.attribute,
          value
        );
      }
    }
  });
}

function ensureGeometry(document: XmlDocument, diagnostics: Diagnostic[]): void {
  const root = document.documentElement;
  if (!root.getAttribute('viewBox')) {
    const widthText = root.getAttribute('width') ?? '';
    const heightText = root.getAttribute('height') ?? '';
    if (!NUMERIC_DIMENSION.test(widthText) || !NUMERIC_DIMENSION.test(heightText)) {
      diagnostics.push({
        code: 'missing-viewbox',
        severity: 'error',
        message: 'SVG has no viewBox and numeric width plus height are unavailable; output geometry cannot be derived.',
      });
      return;
    }
    const width = Number.parseFloat(widthText);
    const height = Number.parseFloat(heightText);
    if (!(width > 0 && height > 0)) {
      diagnostics.push({
        code: 'missing-viewbox',
        severity: 'error',
        message: 'SVG width and height must be positive numbers when deriving a missing viewBox.',
      });
      return;
    }
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  root.setAttribute('width', '100%');
  root.setAttribute('height', 'auto');
  if (!root.getAttribute('preserveAspectRatio')) {
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
}

function applyMetadata(document: XmlDocument, options: TransformOptions): void {
  const root = document.documentElement;
  const metadata = options.metadata;
  if (!metadata) return;
  if (metadata.role) root.setAttribute('role', metadata.role);
  const addText = (tag: 'title' | 'desc', value?: string): void => {
    if (!value) return;
    const existing = query(root, tag)[0];
    const element = existing ?? document.createElementNS('http://www.w3.org/2000/svg', tag);
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(document.createTextNode(value));
    if (!existing) root.insertBefore(element, root.firstChild);
  };
  addText('title', metadata.title);
  addText('desc', metadata.description);
}

function injectAdaptivePresets(
  document: XmlDocument,
  manifest: ThemedSvgManifest,
  light: Palette,
  dark: Palette
): void {
  const id = `themed-svg-${manifest.namespace}-presets`;
  const previous = query(document.documentElement, `#${id}`)[0];
  if (previous) previous.parentNode.removeChild(previous);
  const declarations = (palette: Palette): string =>
    manifest.tokens
      .filter(({ id: token }) => palette[token])
      .map(({ id: token }) => `${cssVariableName(manifest.namespace, token)}:${palette[token]};`)
      .join('');
  const css = `:where(:root){${declarations(light)}}@media (prefers-color-scheme:dark){:where(:root){${declarations(dark)}}}`;
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.setAttribute('id', id);
  style.appendChild(document.createTextNode(css));
  document.documentElement.insertBefore(style, document.documentElement.firstChild);
}

function transformOne(
  svg: string,
  manifest: ThemedSvgManifest,
  outputMode: 'fixed' | 'standalone-adaptive' | 'host',
  preset: string,
  paletteMode: PaletteMode,
  options: TransformOptions
): TransformResult {
  const parsed = parseSvg(svg);
  const diagnostics = [...validateManifest(manifest), ...parsed.diagnostics];
  if (!parsed.document || diagnostics.some(({ severity }) => severity === 'error')) {
    return { diagnostics };
  }
  ensureGeometry(parsed.document, diagnostics);
  if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics };

  const palette = resolvePalette(manifest, preset, paletteMode, options);
  diagnostics.push(...validatePalette(palette, `${preset} palette`));
  if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics };
  applyBindings(parsed.document, manifest, outputMode, palette, diagnostics);
  applyMetadata(parsed.document, options);
  if (outputMode === 'standalone-adaptive') {
    const light = resolvePalette(manifest, 'light', 'light', options);
    const dark = resolvePalette(manifest, 'dark', 'dark', options);
    diagnostics.push(
      ...validatePalette(light, 'light palette'),
      ...validatePalette(dark, 'dark palette')
    );
    if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics };
    injectAdaptivePresets(
      parsed.document,
      manifest,
      light,
      dark
    );
  }
  diagnostics.push(...safetyDiagnostics(parsed.document));
  if (diagnostics.some(({ severity }) => severity === 'error')) return { diagnostics };
  return { svg: new XMLSerializer().serializeToString(parsed.document), diagnostics };
}

export function transformSvg(
  svg: string,
  manifest: ThemedSvgManifest,
  options: TransformOptions = {}
): TransformResult {
  const mode = options.mode ?? 'host';
  if (mode === 'paired-fixed') {
    const light = transformOne(svg, manifest, 'fixed', 'light', 'light', options);
    const dark = transformOne(svg, manifest, 'fixed', 'dark', 'dark', options);
    return {
      ...(light.svg ? { lightSvg: light.svg } : {}),
      ...(dark.svg ? { darkSvg: dark.svg } : {}),
      diagnostics: [...light.diagnostics, ...dark.diagnostics],
    };
  }
  const preset = options.preset ?? manifest.defaultPreset;
  const paletteMode: PaletteMode = preset === 'dark' ? 'dark' : 'light';
  return transformOne(svg, manifest, mode, preset, paletteMode, options);
}

/** Migration and diagnostics helper only. It never changes SVG content. */
export function discoverLiteralColors(svg: string): LiteralColorOccurrence[] {
  const parsed = parseSvg(svg);
  if (!parsed.document) return [];
  const occurrences: LiteralColorOccurrence[] = [];
  for (const element of elements(parsed.document.documentElement)) {
    const selector = element.getAttribute('id')
      ? `#${element.getAttribute('id')}`
      : String(element.tagName);
    for (const property of ['fill', 'stroke', 'color', 'stop-color']) {
      const value = element.getAttribute(property);
      if (value && COLOR_VALUE.test(value.trim())) {
        occurrences.push({ value, selector, property });
      }
    }
    const style = element.getAttribute('style');
    if (style) {
      postcss.parse(`x{${style}}`).walkDecls((declaration) => {
        if (COLOR_VALUE.test(declaration.value.trim())) {
          occurrences.push({ value: declaration.value, selector, property: declaration.prop });
        }
      });
    }
    if (String(element.tagName).toLowerCase() === 'style') {
      postcss.parse(element.textContent ?? '').walkDecls((declaration) => {
        if (COLOR_VALUE.test(declaration.value.trim())) {
          occurrences.push({ value: declaration.value, selector: '<stylesheet>', property: declaration.prop });
        }
      });
    }
  }
  return occurrences;
}
