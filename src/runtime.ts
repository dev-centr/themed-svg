const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_TAGS = new Set([
  'a',
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
]);
const ownedRegistrations = new WeakMap<CustomElementRegistry, CustomElementConstructor>();
let accessibleId = 0;

export type ThemedSvgRuntimeErrorCode =
  | 'invalid-url'
  | 'untrusted-origin'
  | 'http-error'
  | 'invalid-content-type'
  | 'too-large'
  | 'invalid-svg'
  | 'unsafe-svg'
  | 'inaccessible-svg'
  | 'aborted';

export class ThemedSvgRuntimeError extends Error {
  constructor(
    public readonly code: ThemedSvgRuntimeErrorCode,
    message: string,
    public readonly url?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ThemedSvgRuntimeError';
  }
}

export interface ThemedSvgAccessibility {
  alt?: string;
  description?: string;
}

export interface MountThemedSvgOptions extends ThemedSvgAccessibility {
  trustedOrigins?: readonly string[];
  maxBytes?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onLoad?: (svg: SVGSVGElement) => void;
  onError?: (error: ThemedSvgRuntimeError) => void;
  onAbort?: (error: ThemedSvgRuntimeError) => void;
  onLoading?: () => void;
}

export interface ThemedSvgMount {
  readonly host: HTMLElement;
  readonly loaded: Promise<SVGSVGElement>;
  reload(src?: string | URL): Promise<SVGSVGElement>;
  abort(reason?: unknown): void;
  dispose(): void;
  setAccessibility(accessibility: ThemedSvgAccessibility): void;
}

export interface DefineThemedSvgElementOptions {
  trustedOrigins?: readonly string[];
  maxBytes?: number;
}

export interface UpgradeThemedSvgImageOptions {
  hostSrc?: string | URL;
  description?: string;
}

export interface UpgradeThemedSvgImagesOptions {
  selector?: string;
  sourceAttribute?: string;
  descriptionAttribute?: string;
}

function runtimeError(
  code: ThemedSvgRuntimeErrorCode,
  message: string,
  url?: string,
  cause?: unknown
): ThemedSvgRuntimeError {
  return new ThemedSvgRuntimeError(
    code,
    message,
    url,
    cause === undefined ? undefined : { cause }
  );
}

function asRuntimeError(error: unknown, url?: string): ThemedSvgRuntimeError {
  if (error instanceof ThemedSvgRuntimeError) return error;
  if (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
  ) {
    return runtimeError('aborted', 'The SVG load was aborted.', url, error);
  }
  return runtimeError('invalid-svg', 'The SVG could not be loaded safely.', url, error);
}

function allowedOrigins(documentOrigin: string, trusted: readonly string[]): Set<string> {
  const origins = new Set([documentOrigin]);
  for (const value of trusted) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw runtimeError('invalid-url', 'A trusted origin is not a valid absolute URL.');
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value.replace(/\/$/, '')) {
      throw runtimeError('invalid-url', 'Trusted origins must be canonical HTTP(S) origins.');
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function resolveTrustedUrl(
  value: string | URL,
  baseUri: string,
  origins: Set<string>
): URL {
  let url: URL;
  try {
    url = new URL(String(value), baseUri);
  } catch {
    throw runtimeError('invalid-url', 'The SVG URL is invalid.');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw runtimeError('invalid-url', 'Only HTTP(S) SVG URLs are supported.', url.href);
  }
  if (!origins.has(url.origin)) {
    throw runtimeError('untrusted-origin', 'The SVG URL origin is not trusted.', url.href);
  }
  return url;
}

async function readBoundedBody(response: Response, maxBytes: number, url: string): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null) {
    const parsed = Number(length);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw runtimeError('too-large', 'The SVG exceeds the configured byte limit.', url);
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw runtimeError('too-large', 'The SVG exceeds the configured byte limit.', url);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    total = value.byteLength;
    if (total > maxBytes) {
      throw runtimeError('too-large', 'The SVG exceeds the configured byte limit.', url);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw runtimeError('invalid-svg', 'The SVG response is not valid UTF-8.', url, error);
  }
}

function normalizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\([\s\S])/g, '$1');
}

function assertSafeCss(css: string, view: Window, url: string): void {
  const normalized = normalizeCss(css);
  if (
    /@import\b/i.test(normalized)
    || /(?:expression\s*\(|(?:^|[;{\s])behavior\s*:|-moz-binding\s*:)/i.test(normalized)
    || /(?::host\b|::slotted\s*\()/i.test(normalized)
  ) {
    throw runtimeError('unsafe-svg', 'The SVG contains unsafe CSS.', url);
  }

  let urlCount = 0;
  const withoutUrls = normalized.replace(/url\s*\(\s*([^)]*)\)/gi, (_match, raw: string) => {
    urlCount++;
    let target = raw.trim();
    if (
      (target.startsWith('"') && target.endsWith('"'))
      || (target.startsWith("'") && target.endsWith("'"))
    ) {
      target = target.slice(1, -1).trim();
    }
    if (!/^#[^\s"'()\\]+$/.test(target)) {
      throw runtimeError('unsafe-svg', 'The SVG contains an external or malformed CSS URL.', url);
    }
    return '';
  });
  if (/url\s*\(/i.test(withoutUrls) || (urlCount === 0 && /\burl\b/i.test(normalized))) {
    throw runtimeError('unsafe-svg', 'The SVG contains a malformed CSS URL.', url);
  }

  const Sheet = (view as unknown as { CSSStyleSheet?: typeof CSSStyleSheet }).CSSStyleSheet;
  if (typeof Sheet !== 'function') {
    throw runtimeError('unsafe-svg', 'This browser cannot safely validate SVG styles.', url);
  }
  const sheet = new Sheet();
  try {
    sheet.replaceSync(normalized);
  } catch (error) {
    throw runtimeError('unsafe-svg', 'The SVG contains malformed CSS.', url, error);
  }
  const inspectRules = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      const candidate = rule as CSSStyleRule & { cssRules?: CSSRuleList };
      if (
        typeof candidate.selectorText === 'string'
        && /(?::host\b|::slotted\s*\()/i.test(normalizeCss(candidate.selectorText))
      ) {
        throw runtimeError('unsafe-svg', 'The SVG contains a shadow-escaping selector.', url);
      }
      if (candidate.cssRules) inspectRules(candidate.cssRules);
    }
  };
  inspectRules(sheet.cssRules);
}

function assertSafeTree(svg: SVGSVGElement, view: Window, url: string): void {
  if (svg.namespaceURI !== SVG_NAMESPACE || svg.localName !== 'svg') {
    throw runtimeError('invalid-svg', 'The response root is not an SVG element.', url);
  }
  for (const element of Array.from(svg.querySelectorAll('*'))) {
    if (element.namespaceURI !== SVG_NAMESPACE) {
      throw runtimeError('unsafe-svg', 'The SVG contains a foreign namespace.', url);
    }
    if (FORBIDDEN_TAGS.has(element.localName.toLowerCase())) {
      throw runtimeError('unsafe-svg', 'The SVG contains a forbidden element.', url);
    }
  }
  for (const element of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      if (
        attribute.namespaceURI !== null
        && attribute.namespaceURI !== XLINK_NAMESPACE
        && attribute.namespaceURI !== XML_NAMESPACE
        && attribute.namespaceURI !== XMLNS_NAMESPACE
      ) {
        throw runtimeError('unsafe-svg', 'The SVG contains a foreign attribute namespace.', url);
      }
      if (
        name.startsWith('on')
        || name === 'src'
        || name === 'autofocus'
        || name === 'contenteditable'
      ) {
        throw runtimeError('unsafe-svg', 'The SVG contains a forbidden attribute.', url);
      }
      if ((name === 'href' || attribute.name.toLowerCase() === 'xlink:href')
        && !/^#[^\s"'()\\]+$/.test(attribute.value.trim())) {
        throw runtimeError('unsafe-svg', 'The SVG contains an external or malformed link.', url);
      }
      if (/url\s*\(/i.test(normalizeCss(attribute.value))) {
        assertSafeCss(`x{value:${attribute.value}}`, view, url);
      }
    }
    if (element.localName.toLowerCase() === 'style') {
      assertSafeCss(element.textContent ?? '', view, url);
    }
    const inlineStyle = element.getAttribute('style');
    if (inlineStyle !== null) assertSafeCss(`x{${inlineStyle}}`, view, url);
  }
}

async function parseAndSanitize(
  source: string,
  ownerDocument: Document,
  url: string
): Promise<SVGSVGElement> {
  if (/<!\s*(?:doctype|entity)\b/i.test(source)) {
    throw runtimeError('invalid-svg', 'DTD and entity declarations are forbidden.', url);
  }
  const view = ownerDocument.defaultView;
  if (!view) throw runtimeError('invalid-svg', 'The target document has no browser view.', url);
  const parsed = new view.DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    throw runtimeError('invalid-svg', 'The SVG XML is malformed.', url);
  }
  const root = parsed.documentElement as unknown as SVGSVGElement;
  assertSafeTree(root, view, url);

  const imported = ownerDocument.importNode(root, true) as SVGSVGElement;
  const module = await import('dompurify');
  interface Purifier {
    sanitize(dirty: Node, config: Record<string, unknown>): Node;
  }
  const candidate = module.default as unknown as Partial<Purifier> & ((window: Window) => Purifier);
  const purifier: Purifier = typeof candidate.sanitize === 'function'
    ? candidate as Purifier
    : candidate(view);
  purifier.sanitize(imported, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: ['autofocus', 'contenteditable', 'src'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    IN_PLACE: true,
  });
  assertSafeTree(imported, view, url);
  return imported;
}

function nextAccessibleId(svg: SVGSVGElement, kind: 'title' | 'desc'): string {
  let id: string;
  do id = `themed-svg-runtime-${kind}-${++accessibleId}`;
  while (svg.querySelector(`#${id}`));
  return id;
}

function directChild(svg: SVGSVGElement, name: 'title' | 'desc'): SVGElement | undefined {
  return Array.from(svg.children).find((child) => child.localName === name) as SVGElement | undefined;
}

function setTextElement(svg: SVGSVGElement, name: 'title' | 'desc', value: string): SVGElement {
  const element = directChild(svg, name) ?? svg.ownerDocument.createElementNS(SVG_NAMESPACE, name);
  element.replaceChildren(svg.ownerDocument.createTextNode(value));
  element.id = nextAccessibleId(svg, name);
  if (!element.parentNode) svg.insertBefore(element, svg.firstChild);
  return element;
}

function hasAccessibleName(svg: SVGSVGElement): boolean {
  if (svg.getAttribute('aria-label')?.trim()) return true;
  const labelledBy = svg.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  if (labelledBy.some((id) => svg.querySelector(`[id="${CSS.escape(id)}"]`)?.textContent?.trim())) {
    return true;
  }
  return Boolean(directChild(svg, 'title')?.textContent?.trim());
}

function applyAccessibility(
  svg: SVGSVGElement,
  accessibility: ThemedSvgAccessibility,
  url?: string
): void {
  if (accessibility.alt === '') {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-label');
    svg.removeAttribute('aria-labelledby');
    svg.removeAttribute('aria-describedby');
    return;
  }
  svg.removeAttribute('aria-hidden');
  svg.setAttribute('focusable', 'false');
  if (accessibility.alt !== undefined) {
    const title = setTextElement(svg, 'title', accessibility.alt);
    svg.setAttribute('role', 'img');
    svg.removeAttribute('aria-label');
    svg.setAttribute('aria-labelledby', title.id);
  }
  if (accessibility.description !== undefined) {
    const description = setTextElement(svg, 'desc', accessibility.description);
    svg.setAttribute('aria-describedby', description.id);
  }
  if (!hasAccessibleName(svg)) {
    throw runtimeError('inaccessible-svg', 'The SVG has no accessible name.', url);
  }
  if (!svg.hasAttribute('role')) svg.setAttribute('role', 'img');
}

export function mountThemedSvg(
  target: Element,
  src: string | URL,
  options: MountThemedSvgOptions = {}
): ThemedSvgMount {
  const ownerDocument = target.ownerDocument;
  const view = ownerDocument.defaultView;
  if (!view) throw runtimeError('invalid-svg', 'The target must belong to a browser document.');
  const host = ownerDocument.createElement('span');
  host.setAttribute('part', 'themed-svg-container');
  const shadow = host.attachShadow({ mode: 'open' });
  target.append(host);

  let currentSource = src;
  let accessibility: ThemedSvgAccessibility = {
    ...(options.alt !== undefined ? { alt: options.alt } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
  };
  let controller: AbortController | undefined;
  let sequence = 0;
  let disposed = false;
  let currentPromise: Promise<SVGSVGElement>;

  const trusted = allowedOrigins(
    new URL(ownerDocument.baseURI).origin,
    options.trustedOrigins ?? []
  );
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw runtimeError('too-large', 'The SVG byte limit must be a positive safe integer.');
  }

  const run = (nextSource?: string | URL): Promise<SVGSVGElement> => {
    if (disposed) {
      return Promise.reject(runtimeError('aborted', 'The themed SVG mount is disposed.'));
    }
    if (nextSource !== undefined) currentSource = nextSource;
    if (controller && !controller.signal.aborted) {
      const aborted = runtimeError('aborted', 'The SVG load was superseded.');
      controller.abort(aborted);
      options.onAbort?.(aborted);
    }
    const ownController = new view.AbortController();
    controller = ownController;
    const runSequence = ++sequence;
    options.onLoading?.();
    const requested = resolveTrustedUrl(currentSource, ownerDocument.baseURI, trusted);
    let removeExternalAbort: (() => void) | undefined;
    if (options.signal) {
      const abort = (): void => ownController.abort(options.signal?.reason);
      if (options.signal.aborted) abort();
      else {
        options.signal.addEventListener('abort', abort, { once: true });
        removeExternalAbort = () => options.signal?.removeEventListener('abort', abort);
      }
    }

    const promise = (async (): Promise<SVGSVGElement> => {
      try {
        const fetcher = options.fetch ?? view.fetch.bind(view);
        const response = await fetcher(requested, {
          signal: ownController.signal,
          redirect: 'follow',
          credentials: requested.origin === new URL(ownerDocument.baseURI).origin
            ? 'same-origin'
            : 'omit',
          headers: { Accept: 'image/svg+xml' },
        });
        const responseUrl = resolveTrustedUrl(response.url || requested.href, ownerDocument.baseURI, trusted);
        if (!response.ok) {
          throw runtimeError('http-error', `The SVG request failed with HTTP ${response.status}.`, responseUrl.href);
        }
        const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (mime !== 'image/svg+xml') {
          throw runtimeError('invalid-content-type', 'The response is not image/svg+xml.', responseUrl.href);
        }
        const source = await readBoundedBody(response, maxBytes, responseUrl.href);
        const svg = await parseAndSanitize(source, ownerDocument, responseUrl.href);
        applyAccessibility(svg, accessibility, responseUrl.href);
        if (runSequence !== sequence || ownController.signal.aborted || disposed) {
          throw runtimeError('aborted', 'The SVG load was superseded.', responseUrl.href);
        }
        shadow.replaceChildren(svg);
        options.onLoad?.(svg);
        return svg;
      } catch (error) {
        const converted = ownController.signal.aborted
          ? runtimeError('aborted', 'The SVG load was aborted.', requested.href, error)
          : asRuntimeError(error, requested.href);
        if (converted.code !== 'aborted' && runSequence === sequence) options.onError?.(converted);
        throw converted;
      } finally {
        removeExternalAbort?.();
      }
    })();
    currentPromise = promise;
    return promise;
  };

  const abort = (reason?: unknown): void => {
    if (!controller || controller.signal.aborted) return;
    const error = runtimeError('aborted', 'The SVG load was aborted.');
    controller.abort(reason ?? error);
    options.onAbort?.(error);
  };
  const setAccessibility = (next: ThemedSvgAccessibility): void => {
    accessibility = {
      ...(next.alt !== undefined ? { alt: next.alt } : {}),
      ...(next.description !== undefined ? { description: next.description } : {}),
    };
    const svg = shadow.querySelector('svg');
    if (svg) applyAccessibility(svg, accessibility);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    sequence++;
    abort('disposed');
    host.remove();
  };

  currentPromise = run();
  return {
    host,
    get loaded() { return currentPromise; },
    reload: run,
    abort,
    dispose,
    setAccessibility,
  };
}

export function hostSvgSource(source: string): string {
  const match = /^(.*?)(?:\.host)?\.svg([?#].*)?$/i.exec(source);
  if (!match) {
    throw runtimeError('invalid-url', 'A fallback SVG source must end in .svg.');
  }
  return `${match[1]}.host.svg${match[2] ?? ''}`;
}

export function upgradeThemedSvgImage(
  image: HTMLImageElement,
  options: UpgradeThemedSvgImageOptions = {}
): HTMLElement {
  if (image.dataset.themedSvgUpgraded === 'true') {
    const existing = image.parentElement;
    if (existing?.localName === 'themed-svg') return existing;
    throw runtimeError('invalid-svg', 'The image upgrade marker has no themed SVG parent.');
  }
  const parent = image.parentNode;
  if (!parent) throw runtimeError('invalid-svg', 'The fallback image must be connected to a parent.');

  defineThemedSvgElement();
  const source = image.getAttribute('src');
  if (!source && options.hostSrc === undefined) {
    throw runtimeError('invalid-url', 'The fallback image requires a src attribute.');
  }

  const element = image.ownerDocument.createElement('themed-svg');
  element.setAttribute('src', String(options.hostSrc ?? hostSvgSource(source!)));
  element.setAttribute('alt', image.getAttribute('alt') ?? '');
  const description = options.description ?? image.dataset.themedSvgDescription;
  if (description !== undefined) element.setAttribute('description', description);
  element.setAttribute('data-themed-svg-upgrade', '');

  const next = image.nextSibling;
  image.dataset.themedSvgUpgraded = 'true';
  element.append(image);
  parent.insertBefore(element, next);
  return element;
}

export function upgradeThemedSvgImages(
  root?: ParentNode,
  options: UpgradeThemedSvgImagesOptions = {}
): HTMLElement[] {
  const scope = root ?? globalThis.document;
  if (!scope) return [];
  const selector = options.selector ?? 'img[data-themed-svg]';
  const sourceAttribute = options.sourceAttribute ?? 'data-themed-svg-src';
  const descriptionAttribute = options.descriptionAttribute ?? 'data-themed-svg-description';
  return Array.from(scope.querySelectorAll<HTMLImageElement>(selector))
    .filter((image) => image.dataset.themedSvgUpgraded !== 'true')
    .map((image) => upgradeThemedSvgImage(image, {
      ...(image.getAttribute(sourceAttribute)
        ? { hostSrc: image.getAttribute(sourceAttribute)! }
        : {}),
      ...(image.getAttribute(descriptionAttribute)
        ? { description: image.getAttribute(descriptionAttribute)! }
        : {}),
    }));
}

function eventDetail(error: ThemedSvgRuntimeError): Readonly<Record<string, string>> {
  return Object.freeze({
    code: error.code,
    message: error.message,
    ...(error.url ? { url: error.url } : {}),
  });
}

export function defineThemedSvgElement(
  options: DefineThemedSvgElementOptions = {}
): CustomElementConstructor | undefined {
  const environment = globalThis as typeof globalThis & {
    HTMLElement?: typeof HTMLElement;
    customElements?: CustomElementRegistry;
  };
  if (!environment.HTMLElement || !environment.customElements) return undefined;
  const registry = environment.customElements;
  const existing = registry.get('themed-svg');
  const owned = ownedRegistrations.get(registry);
  if (existing) {
    if (existing === owned) return existing;
    throw runtimeError('unsafe-svg', 'The custom element name "themed-svg" is already owned by another constructor.');
  }

  const HTMLElementBase = environment.HTMLElement;
  class ThemedSvgElement extends HTMLElementBase {
    static get observedAttributes(): string[] {
      return ['src', 'alt', 'description'];
    }

    private mount?: ThemedSvgMount;
    private readonly mountTarget: HTMLElement;
    private readonly fallbackSlot: HTMLSlotElement;
    private hasLoaded = false;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      const style = this.ownerDocument.createElement('style');
      style.textContent = ':host{display:inline-block;max-width:100%;vertical-align:middle}[part="mount"]{display:block}[part="mount"] span,[part="mount"] svg{display:block;max-width:100%}[part="mount"] svg{height:auto}';
      this.fallbackSlot = this.ownerDocument.createElement('slot');
      this.mountTarget = this.ownerDocument.createElement('span');
      this.mountTarget.setAttribute('part', 'mount');
      this.mountTarget.hidden = true;
      root.append(style, this.fallbackSlot, this.mountTarget);
    }

    connectedCallback(): void {
      if (this.mount) {
        void this.reload();
      } else {
        this.start();
      }
    }

    disconnectedCallback(): void {
      this.abort('disconnected');
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue || !this.isConnected) return;
      if (name === 'src') {
        if (this.mount) void this.reload();
        else this.start();
      } else if (this.mount) {
        try {
          this.mount.setAccessibility(this.accessibility());
        } catch (error) {
          this.fail(asRuntimeError(error));
        }
      }
    }

    reload(): Promise<SVGSVGElement> {
      if (!this.mount) {
        this.start();
        const started = this.mount as ThemedSvgMount | undefined;
        return started?.loaded ?? Promise.reject(runtimeError('invalid-url', 'The component requires a src attribute.'));
      }
      const src = this.getAttribute('src');
      if (!src) {
        const error = runtimeError('invalid-url', 'The component requires a src attribute.');
        this.fail(error);
        return Promise.reject(error);
      }
      return this.track(this.mount.reload(src));
    }

    abort(reason?: unknown): void {
      this.mount?.abort(reason);
    }

    private accessibility(): ThemedSvgAccessibility {
      return {
        ...(this.hasAttribute('alt') ? { alt: this.getAttribute('alt') ?? '' } : {}),
        ...(this.hasAttribute('description') ? { description: this.getAttribute('description') ?? '' } : {}),
      };
    }

    private state(state: 'loading' | 'loaded' | 'error'): void {
      for (const value of ['loading', 'loaded', 'error']) {
        this.toggleAttribute(value, value === state);
      }
      if (state === 'loading' && !this.hasLoaded) {
        this.fallbackSlot.hidden = false;
        this.mountTarget.hidden = true;
      } else if (state === 'loaded') {
        const fallback = this.querySelector('img');
        if (fallback && !this.style.width) {
          const width = fallback.getBoundingClientRect().width;
          if (width > 0) this.style.width = `${width}px`;
        }
        this.hasLoaded = true;
        this.fallbackSlot.hidden = true;
        this.mountTarget.hidden = false;
      } else if (state === 'error' && !this.hasLoaded) {
        this.fallbackSlot.hidden = false;
        this.mountTarget.hidden = true;
      }
    }

    private emit(name: 'load' | 'error' | 'abort', detail?: unknown): void {
      const EventConstructor = this.ownerDocument.defaultView?.CustomEvent;
      if (EventConstructor) this.dispatchEvent(new EventConstructor(name, { detail }));
    }

    private fail(error: ThemedSvgRuntimeError): void {
      this.state('error');
      this.emit('error', eventDetail(error));
    }

    private track(promise: Promise<SVGSVGElement>): Promise<SVGSVGElement> {
      void promise.catch(() => {});
      return promise;
    }

    private start(): void {
      const src = this.getAttribute('src');
      if (!src) {
        queueMicrotask(() => this.fail(runtimeError('invalid-url', 'The component requires a src attribute.')));
        return;
      }
      this.mount = mountThemedSvg(this.mountTarget, src, {
        ...options,
        ...this.accessibility(),
        onLoading: () => this.state('loading'),
        onLoad: () => {
          this.state('loaded');
          this.emit('load');
        },
        onError: (error) => this.fail(error),
        onAbort: (error) => {
          this.removeAttribute('loading');
          this.emit('abort', eventDetail(error));
        },
      });
      this.track(this.mount.loaded);
    }
  }

  registry.define('themed-svg', ThemedSvgElement);
  ownedRegistrations.set(registry, ThemedSvgElement);
  return ThemedSvgElement;
}
