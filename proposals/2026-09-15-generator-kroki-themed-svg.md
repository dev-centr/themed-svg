# RFC: Adaptive / host-themed SVG from diagram generators (Mermaid + Kroki)

**Status:** Submitted upstream (2026-09-15)  
**Upstream filings:**

- Mermaid Ideas discussion: https://github.com/orgs/mermaid-js/discussions/8264
- Kroki issue: https://github.com/yuzutech/kroki/issues/2146

**Audience:** Mermaid and Kroki maintainers / implementers  
**Reference contract:** [`@dev-centr/themed-svg`](https://github.com/dev-centr/themed-svg) (MIT)  
**Adapters (polyfills until upstream lands):**

- [`@dev-centr/mermaid-svg-css-vars`](https://github.com/dev-centr/mermaid-svg-css-vars)
- [`@dev-centr/plantuml-svg-css-vars`](https://github.com/dev-centr/plantuml-svg-css-vars)

This document proposes solving light/dark diagram theming at the **generator and Kroki** layer so every consumer (docs sites, static hosts, Antora, MkDocs, GitHub Pages, IDE previews) inherits a correct default. It deliberately does **not** ask AsciiDoc, Antora, or `asciidoctor-kroki` to own the contract.

---

## Problem

Most diagram tools emit SVG with **literal fixed colors**. Documentation and product UIs commonly deliver those SVGs as:

```html
<img src="diagram.svg" alt="…">
```

Three constraints collide:

1. **External `<img>` is an isolated document.** Host CSS custom properties do not cross the image boundary. A page theme class such as `html[data-theme=dark]` cannot recolor an `<img>` SVG.
2. **`prefers-color-scheme` alone is incomplete.** Many sites ship a **manual** light/dark toggle that diverges from the OS preference. An SVG that only listens to the media query stays wrong after the user toggles the site.
3. **Docs pipelines are widely shared.** Fixing this only inside one docs theme or one AsciiDoc extension leaves Mermaid/PlantUML/Kroki users elsewhere with the same broken diagrams.

Today, sites that care about this problem either:

- bake one theme into the render,
- post-process SVG after generation (our adapters), or
- abandon `<img>` and inline raw SVG with custom CSS (XSS and ID-collision risk without a sanitizing runtime).

A permanent fix belongs where colors are first decided: **the diagram generator**, with optional **Kroki** delivery modes for server-side rendering.

---

## Proposed contract (Themed SVG v1 summary)

[`@dev-centr/themed-svg`](https://github.com/dev-centr/themed-svg) defines a generator-neutral contract. Mermaid/Kroki need not depend on that package; they should emit compatible *behavior*. The essentials:

### Semantic tokens (roles, not hex)

Colors are named by role, for example:

| Token | Role |
| --- | --- |
| `color.canvas` | Diagram background |
| `color.surface.primary` | Primary node / box fill |
| `color.text.primary` | Primary label text |
| `color.border.primary` | Node stroke |
| `color.edge` | Connector stroke |
| `color.accent.primary` | Highlight / primary accent |

Full common set: see [`COMMON_TOKEN_IDS`](https://github.com/dev-centr/themed-svg/blob/main/src/types.ts) and [`schema/themed-svg-manifest-v1.schema.json`](https://github.com/dev-centr/themed-svg/blob/main/schema/themed-svg-manifest-v1.schema.json).

### Light + dark presets

Every adaptive artifact carries **both** a light and a dark palette for the declared tokens. Palette selection is separate from mode selection:

- **Mode selection** chooses light vs dark (`prefers-color-scheme`, or host application state).
- **Palette selection** maps tokens → concrete CSS colors (bundled defaults, site injection, or user theme).

### Delivery modes

| Mode | Use when | Behavior |
| --- | --- | --- |
| `standalone-adaptive` | Portable `<img>` / no JS | Embedded light defaults + `@media (prefers-color-scheme: dark)` dark palette. Follows OS/browser preference only. |
| `host` | Manual site toggles, design-system CSS vars | CSS `var(--…)` references with concrete fallbacks; **no** media query. Intended for sanitized inline / shadow-DOM insertion so host vars inherit. |
| `fixed` / `paired-fixed` | Email, uploads, one-shot assets | Concrete colors only; optional separate light and dark files. |

**Important:** `standalone-adaptive` cannot see a host-page manual toggle. Sites that need toggle fidelity must use `host` delivery (or `paired-fixed` URL swapping). Generators should therefore be able to emit **at least** adaptive and host-shaped web SVG, or expose an official post-render hook so adapters can do so without scraping opaque literals.

### Explicit structure beats color scraping

Reliable theming binds roles to **selectors / stable classes / presentation attributes**, not “find every `#ffffff` and guess.” Generators already know which shape is a node fill vs edge stroke; that knowledge should survive into the SVG (stable classes or data attributes), then map to tokens.

---

## Ask of Mermaid

**Primary ask:** emit web SVG that is theme-ready by default (or behind an explicit opt-in that can become default).

Concrete options (any one is enough to start; prefer A then B):

### A. Native dual-preset / CSS-var SVG export (preferred)

When rendering SVG for the web:

1. Assign stable semantic classes (or data attributes) to node fills, borders, text, edges, and canvas.
2. Emit either:
   - **`standalone-adaptive`:** root stylesheet with light token values and a `prefers-color-scheme: dark` override block; paint via `var()` or dual rules, **or**
   - **`host`:** `var(--mermaid-…, <fallback>)` (or a documented public custom-property namespace) with **no** media query, for host-controlled themes.
3. Keep today’s fixed-theme path for print/PDF/email and for callers that request a single concrete theme.

### B. Official adapter hook (acceptable MVP)

If full native emission is large:

1. Document a stable **post-render SVG transform hook** (or structured theme metadata) that receives the SVG DOM / string **plus** the resolved theme roles Mermaid already computed.
2. Guarantee selectors / classes are stable enough that a first-party or community adapter can rewrite presentation without brittle hex scraping.
3. Ship or bless a reference adapter that produces adaptive + host artifacts (our [`mermaid-svg-css-vars`](https://github.com/dev-centr/mermaid-svg-css-vars) can remain community until an official package exists).

### Non-asks for Mermaid

- Do not require Antora, AsciiDoc, or a specific docs theme.
- Do not force browser JS for the portable `<img>` case (`standalone-adaptive` must work offline as a normal image).
- Do not replace Mermaid’s existing `themeVariables` for callers who want one fixed look.

### Acceptance sketch

- Given a flowchart rendered twice (light site / dark site OS preference), the same `standalone-adaptive` SVG file is readable in both without re-render.
- Given a docs site with a manual dark toggle, a `host` SVG inserted via a sanitizing inline path tracks the toggle without regenerating Mermaid.
- CI can snapshot both artifacts from one `.mmd` source.

---

## Ask of Kroki

Kroki sits in front of Mermaid, PlantUML, and many other engines. Even if generators improve slowly, Kroki can offer a **shared delivery mode** so docs pipelines get adaptive/themed SVG without forking each client.

**Primary ask:** optional adaptive / themed SVG output (or a documented post-process hook) for diagram types that return SVG.

Concrete options:

### A. Query / option for themed delivery

Examples (names illustrative):

- `theme=adaptive` → `standalone-adaptive` SVG (light + `prefers-color-scheme: dark`)
- `theme=host` → CSS-var host SVG with documented custom properties
- default remains today’s fixed-color SVG for compatibility

### B. Post-process hook / plugin point

Allow a server-side transform after the engine returns SVG:

- input: SVG + diagram type + optional theme manifest / palettes
- output: adaptive and/or host SVG
- PlantUML phase can start here even before PlantUML itself grows native tokens

### PlantUML note (phase 2)

PlantUML’s skinparams are powerful but still tend to produce fixed paints. A Kroki post-process (or native PlantUML “semantic skin” later) unblocks Antora/Kroki users without waiting on every engine equally. Our [`plantuml-svg-css-vars`](https://github.com/dev-centr/plantuml-svg-css-vars) is the current polyfill shape.

### Non-asks for Kroki

- Do not require AsciiDoc or Antora-specific APIs.
- Do not break the default fixed SVG response.
- Do not mandate a JavaScript runtime on the client for adaptive `<img>` delivery.

### Acceptance sketch

- `GET` (or convert POST) with an adaptive theme option returns SVG that switches under OS dark mode when used as `<img>`.
- Host theme option returns CSS variables documented in Kroki’s diagram-type docs.
- Existing clients that omit the option keep byte-compatible fixed output.

---

## Non-goals

- Forking or specializing **`asciidoctor-kroki`** as the long-term home of the contract.
- Putting themed diagram semantics into **Antora core** or the **AsciiDoc language**.
- Requiring every consumer to adopt the `@dev-centr/themed-svg` npm package (compatible emission is enough).
- Solving print/PDF color management in this RFC (fixed export remains valid).

Docs tools should stay thin clients of generator/Kroki output.

---

## Migration

Until upstream lands:

1. **Reference contract:** [`themed-svg`](https://github.com/dev-centr/themed-svg) — transform + `<themed-svg>` runtime.
2. **Polyfills:** [`mermaid-svg-css-vars`](https://github.com/dev-centr/mermaid-svg-css-vars), [`plantuml-svg-css-vars`](https://github.com/dev-centr/plantuml-svg-css-vars) post-process generator/Kroki SVG into adaptive + host siblings.
3. **Site convention:** commit `diagram.svg` (standalone-adaptive) + `diagram.host.svg` (host); progressive upgrade from `<img>` when JS is available.

When Mermaid and/or Kroki ship native modes:

- Adapters become thin wrappers or disappear.
- Existing manifests can keep semantic token IDs; only the producer of bindings moves upstream.
- Docs sites drop custom post-process CI once the render service emits compatible artifacts.

---

## Why generator/Kroki (not docs markup)

| Layer | Reach | Fit |
| --- | --- | --- |
| Mermaid | Every Mermaid SVG consumer | Owns shape→color mapping |
| Kroki | Many engines behind one HTTP API | Shared delivery switch for docs CI |
| asciidoctor-kroki / Antora | AsciiDoc-only | Too narrow; duplicates per ecosystem |
| Site CSS alone | Cannot recolor `<img>` SVG | Insufficient |

---

## References

- Contract README: https://github.com/dev-centr/themed-svg/blob/main/README.md
- Manifest schema: https://github.com/dev-centr/themed-svg/blob/main/schema/themed-svg-manifest-v1.schema.json
- Output modes (`host`, `standalone-adaptive`, `fixed`, `paired-fixed`): https://github.com/dev-centr/themed-svg/blob/main/README.adoc
- Mermaid adapter (polyfill): https://github.com/dev-centr/mermaid-svg-css-vars
- PlantUML adapter (polyfill): https://github.com/dev-centr/plantuml-svg-css-vars

---

## Decision request

1. **Mermaid:** Is native adaptive/host SVG export (A) or an official post-render hook (B) the preferred near-term path?
2. **Kroki:** Is a `theme=` (or equivalent) response mode acceptable, or is a post-process plugin the better extension point?
3. Are there naming or security constraints we should align with early (custom property prefixes, SVG sanitization expectations for host mode)?

We are happy to iterate on naming and reduce scope to an MVP that preserves today’s default fixed SVG.
