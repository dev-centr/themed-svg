# @dev-centr/themed-svg

A semantic light/dark theming standard and structural transformer for web SVG
diagrams.

> **Install status:** This package is not yet published to npm. Use a local
> checkout (`pnpm add ../themed-svg`) or pin a GitHub commit
> (`pnpm add github:dev-centr/themed-svg#<commit>`).

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

Use `standalone-adaptive` explicitly for a no-JavaScript external `<img>` that
follows `prefers-color-scheme`, or use `fixed`/`paired-fixed` external images.
External images cannot inherit host CSS variables.

If an existing SVG only needs runtime injection for CSS styling, use an
established injector such as
[`@iconfu/svg-inject`](https://www.npmjs.com/package/@iconfu/svg-inject).
Use `themed-svg` when semantic manifests, palette merging, multiple build
outputs, or its stricter runtime contract are also needed.

The self-contained registration bundle is available at
`browser/themed-svg-element.js`. After publication it can be loaded from the
version-pinned npm CDN URL
`https://cdn.jsdelivr.net/npm/@dev-centr/themed-svg@0.1.0/browser/themed-svg-element.js`;
pre-release commits can use
`https://cdn.jsdelivr.net/gh/dev-centr/themed-svg@COMMIT/browser/themed-svg-element.js`.
The explicit APIs are exported from `@dev-centr/themed-svg/runtime`.

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
[changelog](CHANGELOG.adoc).

Licensed under the [MIT License](LICENSE). Requires Node.js 20 or later.
