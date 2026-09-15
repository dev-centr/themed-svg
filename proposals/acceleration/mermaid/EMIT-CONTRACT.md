# Mermaid emit contract (host delivery)

Maps Mermaid `cssVariableTheme` to Themed SVG **host** mode.

## API

```js
await mermaid.render('id', source, {
  cssVariableTheme: true, // or { prefix: '--mermaid-' }
  webCompatibility: true,
});
```

Defaults are `false` — existing fixed SVG unchanged.

## Mapping

| Mermaid | Themed SVG |
| --- | --- |
| `cssVariableTheme: true` | `host` — CSS vars with concrete fallbacks; no media query |
| (future) dual light/dark media query | `standalone-adaptive` — suitable for `<img>` |
| default / omitted | `fixed` |

khroma still needs **concrete** `themeVariables` at render time. CSS vars are an
**emit** rewrite, not themeVariable inputs (contrast mermaid#6860).

## Before / after

See [`fixtures/before.svg`](fixtures/before.svg) and
[`fixtures/after-host.svg`](fixtures/after-host.svg).

## Polyfill

Until upstream lands:

```bash
pnpm add @dev-centr/mermaid-svg-css-vars
mermaid-svg-css-vars --manifest diagram.theme.json --dual-output diagram.raw.svg
```

Produces `diagram.svg` (standalone-adaptive) + `diagram.host.svg` (host).
