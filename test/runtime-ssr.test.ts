import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as root from '../src/index.js';
import {
  defineThemedSvgElement,
  mountThemedSvg,
} from '../src/runtime.js';

describe('runtime SSR and packaging', () => {
  it('imports the root and runtime modules without browser globals', () => {
    assert.equal(root.defineThemedSvgElement, defineThemedSvgElement);
    assert.equal(root.mountThemedSvg, mountThemedSvg);
    assert.equal(defineThemedSvgElement(), undefined);
  });

  it('resolves the package root and runtime subpath under Node', async () => {
    const importPackage = Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<Record<string, unknown>>;
    const [packageRoot, packageRuntime] = await Promise.all([
      importPackage('@dev-centr/themed-svg'),
      importPackage('@dev-centr/themed-svg/runtime'),
    ]);
    assert.equal(packageRoot.mountThemedSvg, packageRuntime.mountThemedSvg);
    assert.equal(
      (packageRuntime.defineThemedSvgElement as typeof defineThemedSvgElement)(),
      undefined
    );
  });

  it('builds a self-contained auto-registration ESM bundle', () => {
    const bundle = readFileSync('browser/themed-svg-element.js', 'utf8');
    assert.match(bundle, /define\("themed-svg"/);
    assert.doesNotMatch(bundle, /\b(?:import|export)\s+(?:[^("'`]*?\s+from\s*)?["'][^./]/);
    assert.doesNotMatch(bundle, /import\s*\(\s*["'][^./]/);
  });
});
