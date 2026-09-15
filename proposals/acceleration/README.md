# Acceleration package for Mermaid + Kroki uptake

Companion to the RFC:
[`2026-09-15-generator-kroki-themed-svg.md`](../2026-09-15-generator-kroki-themed-svg.md).

Goal: give maintainers something **lift-able** — not only prose.

## Upstream filings

| Venue | URL |
| --- | --- |
| Mermaid Ideas discussion | https://github.com/orgs/mermaid-js/discussions/8264 |
| Mermaid implementation PR | https://github.com/mermaid-js/mermaid/pull/8008 |
| Kroki proposal issue | https://github.com/yuzutech/kroki/issues/2146 |
| Kroki implementation PR | _(filled after open)_ |

## What to lift

### Mermaid (phase 1)

PR [#8008](https://github.com/mermaid-js/mermaid/pull/8008) adds opt-in:

- `cssVariableTheme` → Themed SVG **host** delivery (`var(--mermaid-<slot>, <fallback>)`)
- `webCompatibility` → responsive SVG root attrs

See [`mermaid/EMIT-CONTRACT.md`](mermaid/EMIT-CONTRACT.md) and before/after fixtures under [`mermaid/fixtures/`](mermaid/fixtures/).

Community polyfill until merged: [`@dev-centr/mermaid-svg-css-vars`](https://github.com/dev-centr/mermaid-svg-css-vars).

### Kroki (shared delivery switch)

Proposal PR adds optional `svg-theme=adaptive|host|fixed` post-process hook in
`DiagramHandler` after engine convert. Default remains fixed SVG.

Community polyfills (PlantUML phase 2 especially):
[`@dev-centr/plantuml-svg-css-vars`](https://github.com/dev-centr/plantuml-svg-css-vars).

See [`kroki/HOOK-CONTRACT.md`](kroki/HOOK-CONTRACT.md).

## Stance

DevCentr adapters are **reference implementations / polyfills**, not the forever
home of the idea, and **not** Antora forks. Antora/docs sites are early consumers.
