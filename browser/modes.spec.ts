import { expect, test, type Page } from '@playwright/test';
import { transformSvg, type ThemedSvgManifest } from '../src/index.js';

const manifest: ThemedSvgManifest = {
  schemaVersion: 1,
  namespace: 'browser',
  tokens: [{ id: 'color.surface.primary' }],
  defaultPreset: 'light',
  presets: {
    light: { 'color.surface.primary': '#ff0000' },
    dark: { 'color.surface.primary': '#0000ff' },
  },
  bindings: [
    { kind: 'presentation', selector: '#sample', attribute: 'fill', token: 'color.surface.primary' },
  ],
};

const source = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect id="sample" width="10" height="10" fill="#000"/></svg>';

async function imagePixel(page: Page, svg: string, hostCss = ''): Promise<number[]> {
  const data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await page.setContent(`<style>${hostCss}</style><img id="image" src="${data}"><canvas width="10" height="10"></canvas>`);
  await page.locator('#image').evaluate((image: HTMLImageElement) => image.decode());
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    context.drawImage(document.querySelector('img')!, 0, 0);
    return [...context.getImageData(5, 5, 1, 1).data];
  });
}

test('img resource CSS is isolated from its host document', async ({ page }) => {
  const host = transformSvg(source, manifest, { mode: 'host' }).svg!;
  expect(await imagePixel(
    page,
    host,
    ':root{--themed-svg-browser-color-surface-primary:#00ff00}'
  )).toEqual([255, 0, 0, 255]);
});

test('standalone adaptive img follows light and dark preferences', async ({ page }) => {
  const adaptive = transformSvg(source, manifest, { mode: 'standalone-adaptive' }).svg!;
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await imagePixel(page, adaptive)).toEqual([255, 0, 0, 255]);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await imagePixel(page, adaptive)).toEqual([0, 0, 255, 255]);
});

test('inline host SVG accepts document palette overrides', async ({ page }) => {
  const host = transformSvg(source, manifest, { mode: 'host' }).svg!;
  await page.setContent(
    `<style>:root{--themed-svg-browser-color-surface-primary:#00ff00}</style>${host}`
  );
  await expect(page.locator('#sample')).toHaveCSS('fill', 'rgb(0, 255, 0)');
});

test('fixed output contains no variables or media queries', async ({ page }) => {
  const fixed = transformSvg(source, manifest, { mode: 'fixed' }).svg!;
  expect(fixed).not.toContain('var(');
  expect(fixed).not.toContain('@media');
  expect(await imagePixel(page, fixed)).toEqual([255, 0, 0, 255]);
});
