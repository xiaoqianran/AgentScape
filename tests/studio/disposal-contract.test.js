import { describe, expect, it, vi } from 'vitest';
import { DeveloperSettings } from '../../apps/studio/ui/developer/DeveloperSettings.js';
import { GenerationJobCenter } from '../../apps/studio/ui/generation/GenerationJobCenter.js';
import { createStudioUiBridge } from '../../apps/studio/ui/StudioUiBridge.js';

function fakeElement() {
  const listeners = [];
  return {
    value: '',
    files: [],
    checked: false,
    hidden: false,
    disabled: false,
    textContent: '',
    dataset: {},
    classList: { toggle() {} },
    addEventListener(type, handler, options) { listeners.push({ type, handler, signal: options?.signal }); },
    removeEventListener() {},
    dispatch(type) {
      let called = 0;
      for (const item of listeners) {
        if (item.type === type && !item.signal?.aborted) { item.handler({}); called += 1; }
      }
      return called;
    },
    append() {},
    appendChild() {},
    replaceChildren() {},
    closest() { return null; },
    querySelector() { return null; },
    showModal() {}
  };
}

function fakeDialog() {
  const cache = new Map();
  const dialog = fakeElement();
  dialog.querySelector = (selector) => {
    if (!cache.has(selector)) cache.set(selector, fakeElement());
    return cache.get(selector);
  };
  return { dialog, cache };
}

describe('Studio disposal contract', () => {
  it('DeveloperSettings drops every DOM listener once disposed', () => {
    vi.stubGlobal('document', {
      createElement: () => fakeElement(),
      createTextNode: (text) => ({ text })
    });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const { dialog, cache } = fakeDialog();
      const tools = { call: vi.fn(async () => 'ok') };
      const world = {
        assetModule: { catalog: { list: () => [], search: () => [] } },
        rendering: { diagnostics: () => ({}) }
      };
      const settings = new DeveloperSettings({ dialog, world, tools, gateway: {}, log: vi.fn() }).init();
      const validate = cache.get('#validate-world');
      expect(validate.dispatch('click')).toBe(1);
      settings.dispose();
      expect(settings.listeners.signal.aborted).toBe(true);
      expect(validate.dispatch('click')).toBe(0);
      expect(() => settings.dispose()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('GenerationJobCenter aborts listeners and unsubscribes once destroyed', () => {
    const { dialog } = fakeDialog();
    const center = new GenerationJobCenter({ root: dialog, world: { generation: {} }, log: vi.fn() });
    const off = vi.fn();
    center.unsubscribers.push(off);
    const handler = vi.fn();
    center.buttons.pair.addEventListener('click', handler, { signal: center.listeners.signal });

    center.destroy();
    expect(center.listeners.signal.aborted).toBe(true);
    expect(off).toHaveBeenCalledOnce();
    expect(center.buttons.pair.dispatch('click')).toBe(0);
    center.destroy();
    expect(off).toHaveBeenCalledOnce();
  });

  it('UI bridge isolates a failing subscriber', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bridge = createStudioUiBridge();
      const healthy = vi.fn();
      bridge.subscribe(() => { throw new Error('listener failed'); });
      bridge.subscribe(healthy);
      bridge.setRuntimeStatus('ready', '就绪');
      expect(bridge.getSnapshot().runtimeStatus.state).toBe('ready');
      expect(healthy).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });
});
