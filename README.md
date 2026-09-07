# @dev-centr/themed-svg

A semantic light/dark theming standard and structural transformer for web SVG
diagrams.

> **Install status:** This package is not yet published to npm. Use a local
> checkout (`pnpm add ../themed-svg`) or pin a GitHub commit
> (`pnpm add github:dev-centr/themed-svg#<commit>`).

```ts
import { transformSvg } from '@dev-centr/themed-svg';

const result = transformSvg(svg, manifest, {
  // standalone-adaptive is the default
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

Output modes are `standalone-adaptive` (default), `host`, `fixed`, and
`paired-fixed`. SVGs loaded through `<img>` cannot inherit CSS variables from
the host page; use adaptive or paired output for that boundary. Inline host SVG
can inherit variables and follow a manual host toggle.

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
