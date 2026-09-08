# @dev-centr/themed-svg

A semantic light/dark theming standard and structural transformer for web SVG
diagrams.

```bash
pnpm add @dev-centr/themed-svg
```

```ts
import { transformSvg } from '@dev-centr/themed-svg';

const result = transformSvg(svg, manifest, {
  // host is the default
  palette: sharedPalette,
  lightPalette,
  darkPalette,
});
```

The version 1 manifest provides source provenance, semantic tokens, bundled and
manifest palettes, optional mode overrides, explicit structural bindings, and
fallback behavior. Palette precedence is:

```text
bundled defaults
< manifest preset
< manifest mode override
< runtime shared palette
< runtime mode-specific palette
```

The recommended web path is default `host` output loaded by the sanitizing
`<themed-svg>` runtime component:

```html
<script type="module">
  import '@dev-centr/themed-svg/register';
</script>
<themed-svg src="/diagram.host.svg" alt="System architecture"></themed-svg>
```

For portable documentation and a no-JavaScript fallback, keep the adaptive SVG
as a normal image and progressively upgrade it on owned sites:

```html
<img data-themed-svg src="/diagram.svg" alt="System architecture">
<script type="module">
  import { upgradeThemedSvgImages } from '@dev-centr/themed-svg/register';
  upgradeThemedSvgImages();
</script>
```

The runtime derives `/diagram.host.svg` and hides the original image only after
the sanitized host artifact loads. Use `data-themed-svg-src` to override the
derived URL.

Use `standalone-adaptive` explicitly for a no-JavaScript external `<img>` that
follows `prefers-color-scheme`, or use `fixed`/`paired-fixed` external images.
External images cannot inherit host CSS variables.

If an existing SVG only needs runtime injection for CSS styling, use an
established injector such as
[`@iconfu/svg-inject`](https://www.npmjs.com/package/@iconfu/svg-inject).
Use `themed-svg` when semantic manifests, palette merging, multiple build
outputs, or its stricter runtime contract are also needed.

The self-contained registration bundle is available at
`browser/themed-svg-element.js` and from the version-pinned npm CDN URL
`https://cdn.jsdelivr.net/npm/@dev-centr/themed-svg@0.1.1/browser/themed-svg-element.js`;
unreleased commits can use
`https://cdn.jsdelivr.net/gh/dev-centr/themed-svg@COMMIT/browser/themed-svg-element.js`.
The explicit APIs are exported from `@dev-centr/themed-svg/runtime`.

The committed diagram convention is `diagram.mmd`, `diagram.theme.json`,
`diagram.svg` (`standalone-adaptive`), and `diagram.host.svg` (`host`). Render
Mermaid once, transform the same raw SVG into both outputs, and make CI fail
when regeneration changes either artifact.

Runtime sources are same-origin HTTP(S) by default. Cross-origin access requires
a JavaScript-only `trustedOrigins` allowlist; redirects are rechecked and every
response is sanitized regardless of trust.

The transformer rejects active and external content and changes only explicitly
bound attributes or CSS declarations. Literal color discovery is diagnostics
and migration assistance, never an implicit rewrite strategy. A missing
`viewBox` is derived only from positive numeric width and height; otherwise the
transform returns an error and no output.

Mermaid is one possible downstream consumer. The standard and package are
diagram-generator neutral.

See the full [visitor README](README.adoc), the
[version 1 schema](schema/themed-svg-manifest-v1.schema.json), and the
[changelog](CHANGELOG.adoc). The
[owned-organization migration ledger](ORG-MIGRATION.adoc) records the initial
diagram inventory, canonical source chains, exclusions, and verification gate.

Licensed under the [MIT License](LICENSE). Requires Node.js 20 or later.
