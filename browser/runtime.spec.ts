import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const bundle = readFileSync('browser/themed-svg-element.js', 'utf8');
const basicSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Existing name</title><rect id="sample" width="10" height="10" fill="var(--diagram-fill,#ff0000)"/></svg>';

async function boot(page: Page): Promise<void> {
  await page.route('http://runtime.test/', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body></body></html>',
  }));
  await page.route('http://runtime.test/themed-svg-element.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: bundle,
  }));
  await page.goto('http://runtime.test/');
  await page.evaluate(async () => {
    (window as unknown as { themedSvgRuntime: unknown }).themedSvgRuntime =
      await import('/themed-svg-element.js');
  });
}

async function svgRoute(page: Page, url: string, body = basicSvg): Promise<void> {
  await page.route(url, (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body,
  }));
}

test.beforeEach(async ({ page }) => boot(page));

test('bundle auto-registers and registration is idempotent but detects collisions', async ({ page }) => {
  expect(await page.evaluate(() => Boolean(customElements.get('themed-svg')))).toBe(true);
  expect(await page.evaluate(() => {
    const runtime = (window as any).themedSvgRuntime;
    return runtime.defineThemedSvgElement() === customElements.get('themed-svg');
  })).toBe(true);

  const collision = await page.evaluate(() => new Promise<string>((resolve) => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const frameWindow = frame.contentWindow!;
    frameWindow.customElements.define('themed-svg', class extends frameWindow.HTMLElement {});
    frameWindow.addEventListener('error', (event) => {
      event.preventDefault();
      resolve((event.error as any)?.code ?? '');
    }, { once: true });
    const script = frame.contentDocument!.createElement('script');
    script.type = 'module';
    script.src = 'http://runtime.test/themed-svg-element.js';
    frame.contentDocument!.head.append(script);
  }));
  expect(collision).toBe('unsafe-svg');
});

test('loads same-origin SVG and reflects state and events', async ({ page }) => {
  await svgRoute(page, 'http://runtime.test/good.svg');
  const result = await page.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
    const element = document.createElement('themed-svg');
    element.setAttribute('src', '/good.svg');
    element.setAttribute('alt', 'A diagram');
    const events: string[] = [];
    for (const name of ['load', 'error', 'abort']) element.addEventListener(name, () => events.push(name));
    element.addEventListener('load', () => resolve({
      events,
      loading: element.hasAttribute('loading'),
      loaded: element.hasAttribute('loaded'),
      error: element.hasAttribute('error'),
      shadow: Boolean(element.shadowRoot?.querySelector('[part="themed-svg-container"]')?.shadowRoot?.querySelector('svg')),
    }), { once: true });
    document.body.append(element);
  }));
  expect(result).toEqual({
    events: ['load'],
    loading: false,
    loaded: true,
    error: false,
    shadow: true,
  });
});

test('progressively upgrades marked images while retaining portable fallback behavior', async ({ page }) => {
  await svgRoute(page, 'http://runtime.test/diagram.host.svg');
  await page.route('http://runtime.test/broken.host.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: 'not svg',
  }));

  const result = await page.evaluate(async () => {
    const runtime = (window as any).themedSvgRuntime;
    document.body.innerHTML = `
      <img id="portable" data-themed-svg src="/diagram.svg" alt="Portable diagram">
      <img id="broken" data-themed-svg data-themed-svg-src="/broken.host.svg"
        src="/broken.svg" alt="Broken host diagram">`;
    const [upgraded, broken] = runtime.upgradeThemedSvgImages();
    const portable = upgraded.querySelector('img');
    const loadedEvent = new Promise((resolve) =>
      upgraded.addEventListener('load', resolve, { once: true }));
    const errorEvent = new Promise((resolve) =>
      broken.addEventListener('error', resolve, { once: true }));
    const before = {
      source: upgraded.getAttribute('src'),
      fallbackConnected: portable?.isConnected,
      fallbackParent: portable?.parentElement?.localName,
    };
    await loadedEvent;
    upgraded.style.setProperty('--diagram-fill', '#00ff00');
    const injected = upgraded.shadowRoot
      .querySelector('[part="themed-svg-container"]').shadowRoot.querySelector('rect');
    const loaded = {
      fallbackHidden: upgraded.shadowRoot.querySelector('slot').hidden,
      mountHidden: upgraded.shadowRoot.querySelector('[part="mount"]').hidden,
      fill: getComputedStyle(injected).fill,
    };
    await errorEvent;
    const failed = {
      fallbackHidden: broken.shadowRoot.querySelector('slot').hidden,
      mountHidden: broken.shadowRoot.querySelector('[part="mount"]').hidden,
      fallbackConnected: broken.querySelector('img')?.isConnected,
    };
    return { before, loaded, failed, count: runtime.upgradeThemedSvgImages().length };
  });

  expect(result.before).toEqual({
    source: '/diagram.host.svg',
    fallbackConnected: true,
    fallbackParent: 'themed-svg',
  });
  expect(result.loaded).toEqual({
    fallbackHidden: true,
    mountHidden: false,
    fill: 'rgb(0, 255, 0)',
  });
  expect(result.failed).toEqual({
    fallbackHidden: false,
    mountHidden: true,
    fallbackConnected: true,
  });
  expect(result.count).toBe(0);
});

test('rejects cross-origin by default and permits explicit trusted origins', async ({ page }) => {
  let requests = 0;
  await page.route('http://assets.test/good.svg', (route) => {
    requests++;
    return route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: basicSvg,
    });
  });
  const rejected = await page.evaluate(async () => {
    const target = document.body.appendChild(document.createElement('div'));
    try {
      await (window as any).themedSvgRuntime.mountThemedSvg(
        target,
        'http://assets.test/good.svg',
        { alt: 'Diagram' }
      ).loaded;
      return '';
    } catch (error) {
      return (error as any).code;
    }
  });
  expect(rejected).toBe('untrusted-origin');
  expect(requests).toBe(0);

  const loaded = await page.evaluate(async () => {
    const target = document.body.appendChild(document.createElement('div'));
    const mount = (window as any).themedSvgRuntime.mountThemedSvg(
      target,
      'http://assets.test/good.svg',
      { alt: 'Diagram', trustedOrigins: ['http://assets.test'] }
    );
    return (await mount.loaded).localName;
  });
  expect(loaded).toBe('svg');
  expect(requests).toBe(1);
});

test('rejects a redirect that escapes the trusted origin', async ({ page }) => {
  await page.route('http://assets.test/redirect.svg', (route) => route.fulfill({
    status: 302,
    headers: {
      Location: 'http://evil.test/payload.svg',
      'Access-Control-Allow-Origin': '*',
    },
  }));
  await svgRoute(page, 'http://evil.test/payload.svg');
  const code = await page.evaluate(async () => {
    const target = document.body.appendChild(document.createElement('div'));
    try {
      await (window as any).themedSvgRuntime.mountThemedSvg(
        target,
        'http://assets.test/redirect.svg',
        {
          alt: 'Diagram',
          trustedOrigins: ['http://assets.test'],
          fetch: () => fetch('http://evil.test/payload.svg'),
        }
      ).loaded;
      return '';
    } catch (error) {
      return (error as any).code;
    }
  });
  expect(code).toBe('untrusted-origin');
});

test('enforces status, SVG MIME, Content-Length, and actual byte limits', async ({ page }) => {
  await page.route('http://runtime.test/status.svg', (route) => route.fulfill({
    status: 404,
    contentType: 'image/svg+xml',
    body: 'not included in errors',
  }));
  await page.route('http://runtime.test/mime.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: basicSvg,
  }));
  await page.route('http://runtime.test/length.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    headers: { 'Content-Length': '1000' },
    body: basicSvg,
  }));
  await svgRoute(page, 'http://runtime.test/actual.svg');

  const codes = await page.evaluate(async () => {
    const runtime = (window as any).themedSvgRuntime;
    const results: string[] = [];
    for (const source of ['/status.svg', '/mime.svg', '/length.svg', '/actual.svg']) {
      const target = document.body.appendChild(document.createElement('div'));
      try {
        await runtime.mountThemedSvg(target, source, { alt: 'x', maxBytes: 100 }).loaded;
        results.push('');
      } catch (error) {
        results.push((error as any).code);
      }
    }
    return results;
  });
  expect(codes).toEqual(['http-error', 'invalid-content-type', 'too-large', 'too-large']);
});

test('rejects malformed, active, linked, namespaced, CSS, and SMIL payloads', async ({ page }) => {
  const payloads: Record<string, string> = {
    malformed: '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    html: '<html xmlns="http://www.w3.org/1999/xhtml"></html>',
    script: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><script/></svg>',
    foreign: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><foreignObject/></svg>',
    frame: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><iframe/></svg>',
    link: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><a href="#x"/></svg>',
    event: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><rect onclick="x()"/></svg>',
    href: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><use href="https://evil.test/x.svg#x"/></svg>',
    attrUrl: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><rect fill="url(https://evil.test/x.svg)"/></svg>',
    inline: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><rect style="fill:expression(alert(1))"/></svg>',
    style: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><style>@import "https://evil.test/x.css";</style></svg>',
    font: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><style>@font-face{font-family:x;src:url(https://evil.test/x)}</style></svg>',
    host: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><style>:host{display:none}</style></svg>',
    smil: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><animate attributeName="href" to="https://evil.test"/></svg>',
  };
  for (const [name, body] of Object.entries(payloads)) {
    await svgRoute(page, `http://runtime.test/${name}.svg`, body);
  }
  const codes = await page.evaluate(async (names) => {
    const runtime = (window as any).themedSvgRuntime;
    return Promise.all(names.map(async (name) => {
      const target = document.body.appendChild(document.createElement('div'));
      try {
        await runtime.mountThemedSvg(target, `/${name}.svg`, { alt: 'x' }).loaded;
        return '';
      } catch (error) {
        return (error as any).code;
      }
    }));
  }, Object.keys(payloads));
  expect(codes.every((code) => code === 'unsafe-svg' || code === 'invalid-svg')).toBe(true);
  expect(codes).not.toContain('');
});

test('inherits live custom properties while isolating SVG styles and IDs', async ({ page }) => {
  const styled = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>x</title><style>body{background:rgb(1,2,3)} #sample{stroke:rgb(5,6,7)}</style><rect id="sample" width="10" height="10" fill="var(--diagram-fill,#ff0000)"/></svg>';
  await svgRoute(page, 'http://runtime.test/styled.svg', styled);
  const colors = await page.evaluate(async () => {
    const element = document.createElement('themed-svg');
    element.setAttribute('src', '/styled.svg');
    element.setAttribute('alt', 'Diagram');
    element.style.setProperty('--diagram-fill', '#00ff00');
    document.body.append(element);
    await new Promise((resolve) => element.addEventListener('load', resolve, { once: true }));
    const rect = element.shadowRoot!.querySelector('[part="themed-svg-container"]')!.shadowRoot!.querySelector('rect')!;
    const first = getComputedStyle(rect).fill;
    element.style.setProperty('--diagram-fill', '#0000ff');
    const second = getComputedStyle(rect).fill;
    return [first, second, getComputedStyle(document.body).backgroundColor, document.querySelectorAll('#sample').length];
  });
  expect(colors).toEqual(['rgb(0, 255, 0)', 'rgb(0, 0, 255)', 'rgba(0, 0, 0, 0)', 0]);
});

test('applies decorative, labelled, described, preserved, and required accessibility', async ({ page }) => {
  await svgRoute(page, 'http://runtime.test/a11y.svg');
  await svgRoute(page, 'http://runtime.test/unnamed.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
  const result = await page.evaluate(async () => {
    const runtime = (window as any).themedSvgRuntime;
    const inspect = async (options: Record<string, unknown>) => {
      const target = document.body.appendChild(document.createElement('div'));
      const svg = await runtime.mountThemedSvg(target, '/a11y.svg', options).loaded;
      return {
        hidden: svg.getAttribute('aria-hidden'),
        role: svg.getAttribute('role'),
        title: svg.querySelector('title')?.textContent,
        desc: svg.querySelector('desc')?.textContent,
        labelled: svg.getAttribute('aria-labelledby'),
        described: svg.getAttribute('aria-describedby'),
      };
    };
    const decorative = await inspect({ alt: '' });
    const labelled = await inspect({ alt: 'New name', description: 'Details' });
    const preserved = await inspect({});
    let inaccessible = '';
    try {
      const target = document.body.appendChild(document.createElement('div'));
      await runtime.mountThemedSvg(target, '/unnamed.svg').loaded;
    } catch (error) {
      inaccessible = (error as any).code;
    }
    return { decorative, labelled, preserved, inaccessible };
  });
  expect(result.decorative.hidden).toBe('true');
  expect(result.labelled).toMatchObject({ role: 'img', title: 'New name', desc: 'Details' });
  expect(result.labelled.labelled).toContain('themed-svg-runtime-title-');
  expect(result.labelled.described).toContain('themed-svg-runtime-desc-');
  expect(result.preserved.title).toBe('Existing name');
  expect(result.inaccessible).toBe('inaccessible-svg');
});

test('relabels without refetching', async ({ page }) => {
  let requests = 0;
  await page.route('http://runtime.test/relabel.svg', (route) => {
    requests++;
    return route.fulfill({ contentType: 'image/svg+xml', body: basicSvg });
  });
  const labels = await page.evaluate(async () => {
    const element = document.createElement('themed-svg');
    element.setAttribute('src', '/relabel.svg');
    element.setAttribute('alt', 'First');
    document.body.append(element);
    await new Promise((resolve) => element.addEventListener('load', resolve, { once: true }));
    element.setAttribute('alt', 'Second');
    element.setAttribute('description', 'Changed');
    const svg = element.shadowRoot!.querySelector('[part="themed-svg-container"]')!.shadowRoot!.querySelector('svg')!;
    return [svg.querySelector('title')?.textContent, svg.querySelector('desc')?.textContent];
  });
  expect(labels).toEqual(['Second', 'Changed']);
  expect(requests).toBe(1);
});

test('abort, race, reload, last-good retention, and disconnect are safe', async ({ page }) => {
  let goodRequests = 0;
  await page.route('http://runtime.test/slow.svg', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: basicSvg.replace('sample', 'slow'),
    }).catch(() => {});
  });
  await page.route('http://runtime.test/fast.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: basicSvg.replace('sample', 'fast'),
  }));
  await page.route('http://runtime.test/reload.svg', (route) => {
    goodRequests++;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: basicSvg.replace('sample', `good-${goodRequests}`),
    });
  });
  await page.route('http://runtime.test/fail.svg', (route) => route.fulfill({
    status: 500,
    contentType: 'image/svg+xml',
    body: 'secret body',
  }));

  const result = await page.evaluate(async () => {
    const element = document.createElement('themed-svg');
    element.setAttribute('src', '/slow.svg');
    element.setAttribute('alt', 'Diagram');
    const events: string[] = [];
    element.addEventListener('abort', () => events.push('abort'));
    document.body.append(element);
    element.setAttribute('src', '/fast.svg');
    await new Promise((resolve) => element.addEventListener('load', resolve, { once: true }));
    const shadow = element.shadowRoot!.querySelector('[part="themed-svg-container"]')!.shadowRoot!;
    const raceId = shadow.querySelector('rect')!.id;

    element.setAttribute('src', '/reload.svg');
    await new Promise((resolve) => element.addEventListener('load', resolve, { once: true }));
    await (element as any).reload();
    const reloadId = shadow.querySelector('rect')!.id;
    element.setAttribute('src', '/fail.svg');
    await new Promise((resolve) => element.addEventListener('error', resolve, { once: true }));
    const retainedId = shadow.querySelector('rect')!.id;

    element.setAttribute('src', '/slow.svg');
    const disconnected = new Promise((resolve) => element.addEventListener('abort', resolve, { once: true }));
    element.remove();
    await disconnected;
    return { events, raceId, reloadId, retainedId };
  });
  expect(result.events.length).toBeGreaterThan(0);
  expect(result.raceId).toBe('fast');
  expect(result.reloadId).toBe('good-2');
  expect(result.retainedId).toBe('good-2');
  expect(goodRequests).toBe(2);
});
