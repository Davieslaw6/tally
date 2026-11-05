import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom does not implement layout primitives the chart relies on. These stubs
// let the component measure synchronously while keeping tests deterministic.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) =>
    window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
}

const context2d = {
  fillStyle: '',
  strokeStyle: '',
  font: '',
  textAlign: 'left',
  lineWidth: 1,
  fillRect: () => undefined,
  fillText: () => undefined,
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  stroke: () => undefined,
  drawImage: () => undefined,
};

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: () => context2d,
});

Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
  writable: true,
  value: (callback: BlobCallback, type?: string) => callback(new Blob(['png'], { type: type ?? 'image/png' })),
});

Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: () => 'blob:tally-test',
});

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: () => undefined,
});
