import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, it } from 'node:test';
import {
  exportSvgArtifacts,
  inspectSvg,
  processStdioRequest,
  sanitizeSvg,
  STDIO_PROTOCOL_VERSION,
  type ExportArtifactsResult,
  type SvgInspectionResult,
  type ThemedSvgManifest,
} from '../src/index.js';

const fixtureDirectory = join(process.cwd(), 'test', 'fixtures');
const svg = readFileSync(join(fixtureDirectory, 'editor.svg'), 'utf8');
const manifest = JSON.parse(
  readFileSync(join(fixtureDirectory, 'editor.theme.json'), 'utf8')
) as ThemedSvgManifest;
const packageVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
).version;

describe('editor API', () => {
  it('inspects through the canonical parser', () => {
    const result = inspectSvg(svg);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.inspection?.elementCount, 4);
    assert.deepEqual(result.inspection?.ids, ['surface']);
    assert.equal(result.inspection?.stylesheetCount, 1);
    assert.deepEqual(
      result.inspection?.literalColors.map(({ value }) => value),
      ['#333333', '#eeeeee']
    );
  });

  it('sanitizes fail-closed and serializes safe input deterministically', () => {
    const first = sanitizeSvg(svg);
    const second = sanitizeSvg(svg);
    assert.equal(first.svg, second.svg);
    assert.equal(sanitizeSvg('<svg><script/></svg>').svg, undefined);
  });

  it('exports deterministic adaptive, host, and fixed artifacts', () => {
    const first = exportSvgArtifacts(svg, manifest);
    const second = exportSvgArtifacts(svg, manifest);
    assert.deepEqual(first, second);
    assert.match(first.artifacts.standaloneAdaptive!, /prefers-color-scheme:dark/);
    assert.match(first.artifacts.host!, /var\(--themed-svg-editor-fixture/);
    assert.doesNotMatch(first.artifacts.fixed!, /var\(|prefers-color-scheme/);
    assert.match(first.artifacts.light!, /fill="#eeeeee"/);
    assert.match(first.artifacts.dark!, /fill="#222222"/);
  });
});

describe('stdio protocol version 1', () => {
  it('correlates requests and returns selector-aware diagnostics', () => {
    const response = processStdioRequest({
      protocolVersion: STDIO_PROTOCOL_VERSION,
      id: 'request-7',
      operation: 'transform',
      svg,
      manifest: {
        ...manifest,
        bindings: [{
          kind: 'presentation',
          selector: '#missing',
          attribute: 'fill',
          token: 'color.surface.primary',
        }],
      },
    });
    assert.equal(response.id, 'request-7');
    assert.equal(response.ok, true);
    assert.equal(response.diagnostics[0]?.selector, '#missing');
    assert.equal(response.diagnostics[0]?.source?.path, '/bindings/0/selector');
  });

  it('validates malformed requests without throwing', () => {
    const response = processStdioRequest({
      protocolVersion: 99,
      operation: 'inspect',
      svg,
    });
    assert.equal(response.ok, false);
    assert.equal(response.diagnostics[0]?.code, 'invalid-request');
    assert.equal(response.diagnostics[0]?.source?.path, '/protocolVersion');
  });

  it('validates manifest bindings against SVG targets', () => {
    const response = processStdioRequest({
      protocolVersion: 1,
      operation: 'validate',
      svg,
      manifest: {
        ...manifest,
        bindings: [{
          kind: 'gradient-stop',
          selector: '#missing-stop',
          token: 'color.surface.primary',
        }],
      },
    });
    assert.equal(response.ok, true, 'missing targets warn by default');
    assert.equal(response.diagnostics[0]?.code, 'missing-selector');
    assert.equal(response.diagnostics[0]?.selector, '#missing-stop');
  });

  it('supports JSON and streaming JSONL CLI transports', () => {
    const inspectRequest = {
      protocolVersion: 1,
      id: 1,
      operation: 'inspect',
      svg,
    };
    const exportRequest = {
      protocolVersion: 1,
      id: 2,
      operation: 'export',
      svg,
      manifest,
      options: { modes: ['host'] },
    };
    const json = spawnSync(
      process.execPath,
      ['bin/themed-svg.js', '--stdio', 'json'],
      { encoding: 'utf8', input: JSON.stringify(inspectRequest) }
    );
    assert.equal(json.status, 0, json.stderr);
    const inspection = JSON.parse(json.stdout) as {
      ok: boolean;
      result: SvgInspectionResult;
    };
    assert.equal(inspection.ok, true);
    assert.deepEqual(inspection.result.inspection?.ids, ['surface']);

    const jsonl = spawnSync(
      process.execPath,
      ['bin/themed-svg-stdio.js'],
      {
        encoding: 'utf8',
        input: `${JSON.stringify(inspectRequest)}\nnot-json\n${JSON.stringify(exportRequest)}\n`,
      }
    );
    assert.equal(jsonl.status, 0, jsonl.stderr);
    const responses = jsonl.stdout.trim().split('\n').map(
      (line) => JSON.parse(line) as { id?: number; ok: boolean; result?: ExportArtifactsResult }
    );
    assert.equal(responses.length, 3);
    assert.equal(responses[0]?.id, 1);
    assert.equal(responses[1]?.ok, false);
    assert.equal(responses[2]?.id, 2);
    assert.ok(responses[2]?.result?.artifacts.host);

    const version = spawnSync(
      process.execPath,
      ['bin/themed-svg.js', '--version'],
      { encoding: 'utf8' }
    );
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), packageVersion);
  });

  it('keeps JSONL open for multiple editor requests', async () => {
    const child = spawn(process.execPath, ['bin/themed-svg-stdio.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const request = (id: number): string => JSON.stringify({
      protocolVersion: 1,
      id,
      operation: 'inspect',
      svg,
    });

    child.stdin.write(`${request(1)}\n`);
    const first = await responses.next();
    assert.equal((JSON.parse(first.value!) as { id: number }).id, 1);
    assert.equal(child.exitCode, null);

    child.stdin.write(`${request(2)}\n`);
    const second = await responses.next();
    assert.equal((JSON.parse(second.value!) as { id: number }).id, 2);
    child.stdin.end();
    const [exitCode] = await once(child, 'exit');
    assert.equal(exitCode, 0);
  });
});
