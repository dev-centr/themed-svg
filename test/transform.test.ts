import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  cssVariableName,
  discoverLiteralColors,
  resolvePalette,
  transformSvg,
  validateManifest,
  type ThemedSvgManifest,
} from '../src/index.js';

const manifest: ThemedSvgManifest = {
  schemaVersion: 1,
  namespace: 'test-diagram',
  source: {
    kind: 'diagram-generator',
    uri: 'https://example.invalid/source',
    generator: 'fixture',
    generatedAt: '2026-09-07T00:00:00Z',
  },
  tokens: [
    { id: 'color.surface.primary' },
    { id: 'color.text.primary' },
    { id: 'color.border.primary' },
    { id: 'color.accent.primary' },
  ],
  defaultPreset: 'light',
  presets: {
    light: {
      'color.surface.primary': '#eeeeee',
      'color.text.primary': '#111111',
      'color.border.primary': '#333333',
      'color.accent.primary': '#0066cc',
    },
    dark: {
      'color.surface.primary': '#222222',
      'color.text.primary': '#eeeeee',
      'color.border.primary': '#bbbbbb',
      'color.accent.primary': '#66aaff',
    },
  },
  paletteOverrides: {
    light: { 'color.border.primary': '#444444' },
    dark: { 'color.border.primary': '#aaaaaa' },
  },
  bindings: [
    { kind: 'presentation', selector: '#box', attribute: 'fill', token: 'color.surface.primary' },
    { kind: 'inline-style', selector: '.label', property: 'fill', token: 'color.text.primary' },
    { kind: 'stylesheet', selector: '.edge', property: 'stroke', token: 'color.border.primary' },
    { kind: 'gradient-stop', selector: '#stop', token: 'color.accent.primary' },
  ],
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100">
  <style>.edge { stroke: #333; fill: none }</style>
  <defs><linearGradient id="g"><stop id="stop" stop-color="#06c"/></linearGradient></defs>
  <rect id="box" width="100" height="50" fill="#eee"/>
  <text class="label" style="fill:#111; font-weight:bold">Hello</text>
  <path class="edge" d="M0 0L10 10"/>
  <circle fill="#eee"/><circle fill="#eee"/>
</svg>`;

describe('manifest and palette standard', () => {
  it('uses stable namespaced CSS variables', () => {
    assert.equal(
      cssVariableName('flow-chart', 'color.surface.primary'),
      '--themed-svg-flow-chart-color-surface-primary'
    );
  });

  it('validates namespace, preset, tokens, and explicit binding references', () => {
    assert.deepEqual(validateManifest(manifest), []);
    const invalid = {
      ...manifest,
      namespace: 'Not Valid',
      defaultPreset: 'missing',
      tokens: [...manifest.tokens, { id: 'color.text.primary' }],
      bindings: [
        ...manifest.bindings,
        { kind: 'presentation' as const, selector: '#x', attribute: 'fill' as const, token: 'unknown' },
      ],
    };
    assert.ok(validateManifest(invalid).length >= 4);
  });

  it('applies exact palette precedence', () => {
    const palette = resolvePalette(manifest, 'light', 'light', {
      palette: {
        'color.surface.primary': '#555555',
        'color.border.primary': '#666666',
      },
      lightPalette: { 'color.border.primary': '#777777' },
    });
    assert.equal(palette['color.canvas'], '#ffffff', 'bundled default');
    assert.equal(palette['color.text.primary'], '#111111', 'manifest preset');
    assert.equal(palette['color.surface.primary'], '#555555', 'runtime shared');
    assert.equal(palette['color.border.primary'], '#777777', 'runtime mode-specific');
  });
});

describe('structural transformation golden behavior', () => {
  it('rewrites bound attributes, inline styles, stylesheets, and gradients only', () => {
    const result = transformSvg(svg, manifest, { mode: 'fixed' });
    assert.deepEqual(result.diagnostics, []);
    assert.match(result.svg!, /viewBox="0 0 200 100"/);
    assert.match(result.svg!, /id="box"[^>]*fill="#eeeeee"/);
    assert.match(result.svg!, /style="fill:#111111; font-weight:bold;"/);
    assert.match(result.svg!, /\.edge \{ stroke: #444444; fill: none \}/);
    assert.match(result.svg!, /id="stop" stop-color="#0066cc"/);
    assert.equal((result.svg!.match(/fill="#eee"/g) ?? []).length, 2);
  });

  it('defaults to standalone adaptive and supports all output contracts', () => {
    const adaptive = transformSvg(svg, manifest);
    assert.match(adaptive.svg!, /var\(--themed-svg-test-diagram-color-surface-primary, #eeeeee\)/);
    assert.match(adaptive.svg!, /prefers-color-scheme:dark/);

    const host = transformSvg(svg, manifest, { mode: 'host' }).svg!;
    assert.match(host, /var\(--themed-svg-test-diagram-color-surface-primary, #eeeeee\)/);
    assert.doesNotMatch(host, /prefers-color-scheme/);

    const fixed = transformSvg(svg, manifest, { mode: 'fixed' }).svg!;
    assert.doesNotMatch(fixed, /var\(|prefers-color-scheme/);

    const paired = transformSvg(svg, manifest, { mode: 'paired-fixed' });
    assert.match(paired.lightSvg!, /fill="#eeeeee"/);
    assert.match(paired.darkSvg!, /fill="#222222"/);
    assert.doesNotMatch(paired.lightSvg!, /var\(|prefers-color-scheme/);
    assert.doesNotMatch(paired.darkSvg!, /var\(|prefers-color-scheme/);
  });

  it('is idempotent and preserves IDs', () => {
    const once = transformSvg(svg, manifest).svg!;
    const twice = transformSvg(once, manifest).svg!;
    assert.equal(twice, once);
    assert.match(twice, /linearGradient id="g"/);
  });

  it('reports missing selectors, missing properties, unresolved values, and collisions', () => {
    const broken: ThemedSvgManifest = {
      ...manifest,
      tokens: [...manifest.tokens, { id: 'color.extension.unresolved' }],
      bindings: [
        { kind: 'presentation', selector: '#missing', attribute: 'fill', token: 'color.surface.primary' },
        { kind: 'inline-style', selector: '#box', property: 'stroke', token: 'color.text.primary' },
        { kind: 'presentation', selector: '#box', attribute: 'fill', token: 'color.extension.unresolved' },
        { kind: 'presentation', selector: '#box', attribute: 'fill', token: 'color.surface.primary' },
        { kind: 'presentation', selector: '#box', attribute: 'fill', token: 'color.text.primary' },
      ],
    };
    const result = transformSvg(svg, broken);
    const codes = result.diagnostics.map(({ code }) => code);
    assert.ok(codes.includes('missing-selector'));
    assert.ok(codes.includes('missing-property'));
    assert.ok(codes.includes('unresolved-token'));
    assert.ok(codes.includes('binding-collision'));
    assert.equal(result.svg, undefined);
  });

  it('can preserve unresolved bindings as a warning', () => {
    const preserving: ThemedSvgManifest = {
      ...manifest,
      fallback: { unresolvedToken: 'preserve' },
      tokens: [...manifest.tokens, { id: 'color.extension.unresolved' }],
      bindings: [
        { kind: 'presentation', selector: '#box', attribute: 'fill', token: 'color.extension.unresolved' },
      ],
    };
    const result = transformSvg(svg, preserving, { mode: 'fixed' });
    assert.equal(result.diagnostics[0]?.severity, 'warning');
    assert.match(result.svg!, /fill="#eee"/);
  });

  it('rejects invalid and unsafe XML, active content, events, and external resources', () => {
    for (const unsafe of [
      '<!DOCTYPE svg><svg/>',
      '<svg><script/></svg>',
      '<svg><foreignObject/></svg>',
      '<svg><rect onclick="alert(1)"/></svg>',
      '<svg><image href="https://example.com/x.png"/></svg>',
      '<svg><style>@import "https://example.com/x.css"</style></svg>',
      '<svg><rect style="fill:url(https://example.com/x.svg)"/></svg>',
      '<svg><g></svg>',
    ]) {
      const result = transformSvg(unsafe, manifest);
      assert.ok(result.diagnostics.some(({ severity }) => severity === 'error'), unsafe);
      assert.equal(result.svg, undefined);
    }
  });

  it('never invents a viewBox', () => {
    const missing = transformSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="box"/></svg>',
      manifest
    );
    assert.equal(missing.svg, undefined);
    assert.equal(missing.diagnostics[0]?.code, 'missing-viewbox');

    const nonNumeric = transformSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto"><rect id="box"/></svg>',
      manifest
    );
    assert.equal(nonNumeric.svg, undefined);
    assert.ok(nonNumeric.diagnostics.some(({ code }) => code === 'missing-viewbox'));
  });

  it('discovers literals for diagnostics without rewriting', () => {
    const found = discoverLiteralColors(svg);
    assert.ok(found.some(({ value }) => value === '#eee'));
    assert.ok(found.some(({ selector }) => selector === '<stylesheet>'));
    assert.equal(svg.includes('var('), false);
  });
});

describe('CLI', () => {
  it('accepts modes, shared/mode palettes, and paired output paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'themed-svg-'));
    const input = join(directory, 'input.svg');
    const manifestPath = join(directory, 'manifest.json');
    const shared = join(directory, 'shared.json');
    const light = join(directory, 'light.json');
    const dark = join(directory, 'dark.json');
    const lightOutput = join(directory, 'light.svg');
    const darkOutput = join(directory, 'dark.svg');
    writeFileSync(input, svg);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(shared, JSON.stringify({ 'color.surface.primary': '#123456' }));
    writeFileSync(light, JSON.stringify({ 'color.surface.primary': '#abcdef' }));
    writeFileSync(dark, JSON.stringify({ 'color.surface.primary': '#fedcba' }));

    const paired = spawnSync(process.execPath, [
      'bin/themed-svg.js',
      '--manifest', manifestPath,
      '--mode', 'paired-fixed',
      '--palette', shared,
      '--light-palette', light,
      '--dark-palette', dark,
      '--light-output', lightOutput,
      '--dark-output', darkOutput,
      input,
    ], { encoding: 'utf8' });
    assert.equal(paired.status, 0, paired.stderr);
    assert.match(readFileSync(lightOutput, 'utf8'), /fill="#abcdef"/);
    assert.match(readFileSync(darkOutput, 'utf8'), /fill="#fedcba"/);

    const adaptive = spawnSync(process.execPath, [
      'bin/themed-svg.js',
      '--manifest', manifestPath,
      input,
    ], { encoding: 'utf8' });
    assert.equal(adaptive.status, 0, adaptive.stderr);
    assert.match(adaptive.stdout, /prefers-color-scheme:dark/);
  });
});
