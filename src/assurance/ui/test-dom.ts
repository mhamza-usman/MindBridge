/**
 * jsdom environment for component tests. Imported FIRST in component test files
 * so globals exist before React/testing-library modules evaluate.
 */
import { JSDOM } from 'jsdom';
import Module from 'node:module';

// tsx loads .css imports through the CJS pipeline; stub them for tests.
(Module as any)._extensions['.css'] = (m: any) => { m.exports = {}; };

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/live?ui=v2',
  pretendToBeVisual: true
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
try { g.navigator = dom.window.navigator; } catch { /* Node 26 navigator is getter-only */ }
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.localStorage = dom.window.localStorage;
g.sessionStorage = dom.window.sessionStorage;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as any;
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.self = dom.window;
g.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof g.IntersectionObserver === 'undefined') {
  g.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

if (typeof g.ResizeObserver === 'undefined') {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof g.matchMedia === 'undefined') {
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
}

/**
 * EventSource stub: records instances so tests can push SSE frames.
 * Usage: const es = FakeEventSource.instances.find(i => i.url.includes('replay'));
 *        act(() => es.push({ t: 1, ... }));
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  readyState = 1;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

g.EventSource = FakeEventSource;
