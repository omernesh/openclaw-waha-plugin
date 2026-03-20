// Vitest test setup — runs before each test file.
// DO NOT REMOVE: jsdom polyfills required by shadcn/ui components.
import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock fetch globally — individual tests override per-call.
// Default returns an empty JSON object to prevent "Cannot read properties of undefined" errors
// in components that call fetch() directly (e.g. ContactsTab fetches /api/admin/presence).
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('{}'),
    blob: () => Promise.resolve(new Blob()),
  })
))

// ResizeObserver polyfill — required by many shadcn/radix components
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// IntersectionObserver polyfill — required by some scroll-aware components
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

// EventSource polyfill — required by useEventSource hook (SSE)
class EventSourceStub {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  readyState = 1
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
vi.stubGlobal('EventSource', EventSourceStub)
