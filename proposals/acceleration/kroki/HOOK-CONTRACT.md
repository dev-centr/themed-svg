# Kroki `svg-theme` hook contract

## Option

| Key | Values | Default |
| --- | --- | --- |
| `svg-theme` | `fixed` \| `adaptive` \| `host` | `fixed` (omit) |

Pass via:

- JSON `diagram_options.svg-theme`
- Query `?svg-theme=host`
- Header `Kroki-Diagram-Options-Svg-Theme: adaptive`

## Behavior

| Mode | Response |
| --- | --- |
| `fixed` / omitted | Unchanged engine SVG |
| `host` | Root marked `data-kroki-svg-theme="host"`; engines that already emit CSS vars pass through |
| `adaptive` | Root marked + `prefers-color-scheme` stylesheet scaffold; prefer engine-native dual palettes when available |

Full semantic-token rewriting stays engine-specific. Kroki owns the **delivery switch**; Mermaid/PlantUML own shape→color knowledge.

## Reference implementation

- Java: `io.kroki.server.transform.ThemedSvgPostProcessor`
- Wired from `DiagramHandler.convert` after `service.convert`
- Docs: `docs/modules/setup/pages/diagram-options.adoc` § SVG theme delivery

## Polyfills

- Mermaid: https://github.com/dev-centr/mermaid-svg-css-vars
- PlantUML (phase 2): https://github.com/dev-centr/plantuml-svg-css-vars
