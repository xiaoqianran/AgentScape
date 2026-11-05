import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEALTH_API,
  ServiceHealthMonitor,
  describeReason,
  normalizeHealth,
  offlineHealth,
  summarize
} from '../../apps/observatory/app/ServiceHealthMonitor.js';

const ok = (capabilities) => new Response(JSON.stringify({ capabilities }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('service health normalization', () => {
  it('maps only known states and drops unknown fields', () => {
    const services = normalizeHealth({
      capabilities: {
        agent: { state: 'ok', latencyMs: 41.6, reason: null, checkedAt: '2026-01-01T00:00:00.000Z', url: 'https://secret.test' },
        'asset.compile': { state: 'exploded' }
      }
    });
    expect(services.agent).toEqual({ id: 'agent', state: 'ok', latencyMs: 42, reason: null, checkedAt: '2026-01-01T00:00:00.000Z' });
    expect(services['asset.compile'].state).toBe('unknown');
    expect(JSON.stringify(services)).not.toContain('secret');
  });

  it('tolerates a malformed payload', () => {
    expect(Object.values(normalizeHealth(null)).every((item) => item.state === 'unknown')).toBe(true);
  });

  it('summarizes with the worst state winning', () => {
    const make = (a, b) => ({ agent: { state: a }, 'asset.compile': { state: b } });
    expect(summarize(make('ok', 'ok'))).toBe('ok');
    expect(summarize(make('ok', 'unconfigured'))).toBe('unconfigured');
    expect(summarize(make('ok', 'slow'))).toBe('slow');
    expect(summarize(make('slow', 'down'))).toBe('down');
    expect(summarize(offlineHealth())).toBe('offline');
  });

  it('describes reasons without exposing raw upstream text', () => {
    expect(describeReason('HTTP_503')).toBe('上游暂不可用');
    expect(describeReason('HTTP_418')).toBe('上游返回 418');
    expect(describeReason('whatever')).toBe('未知原因');
    expect(describeReason(null)).toBe('');
  });
});

describe('ServiceHealthMonitor', () => {
  it('polls the same-origin health API and publishes normalized state', async () => {
    const fetchImpl = vi.fn(async () => ok({ agent: { state: 'ok', latencyMs: 12 }, 'asset.compile': { state: 'unconfigured', reason: 'NOT_CONFIGURED' } }));
    const onChange = vi.fn();
    const monitor = new ServiceHealthMonitor({ fetchImpl, onChange, intervalMs: 1_000_000 });
    monitor.start();
    await monitor.refresh();
    expect(fetchImpl).toHaveBeenCalledWith(HEALTH_API, expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].agent.state).toBe('ok');
    monitor.stop();
  });

  it('shares one in-flight request between concurrent refreshes', async () => {
    let release;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { release = () => resolve(ok({})); }));
    const monitor = new ServiceHealthMonitor({ fetchImpl, intervalMs: 1_000_000 });
    monitor.start();
    const a = monitor.refresh();
    const b = monitor.refresh();
    expect(a).toBe(b);
    release();
    await a;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it('falls back to offline when the health API fails and recovers on the next poll', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(ok({ agent: { state: 'ok' }, 'asset.compile': { state: 'ok' } }));
    const seen = [];
    const monitor = new ServiceHealthMonitor({ fetchImpl, intervalMs: 500, onChange: (s) => seen.push(summarize(s)) });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['offline']);
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual(['offline', 'ok']);
    monitor.stop();
  });

  it('reports TIMEOUT when the request is aborted by the deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    let latest;
    const monitor = new ServiceHealthMonitor({ fetchImpl, timeoutMs: 100, intervalMs: 1_000_000, onChange: (s) => { latest = s; } });
    monitor.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(latest.agent).toMatchObject({ state: 'offline', reason: 'TIMEOUT' });
    monitor.stop();
  });

  it('does not publish or reschedule after stop()', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ok({}));
    const onChange = vi.fn();
    const monitor = new ServiceHealthMonitor({ fetchImpl, intervalMs: 100, onChange });
    monitor.start();
    monitor.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('pauses polling while the tab is hidden and resumes with an immediate probe', async () => {
    vi.useFakeTimers();
    const listeners = new Set();
    const documentRef = {
      hidden: false,
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn)
    };
    const fetchImpl = vi.fn(async () => ok({}));
    const monitor = new ServiceHealthMonitor({ fetchImpl, intervalMs: 100, documentRef });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    documentRef.hidden = true;
    listeners.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    documentRef.hidden = false;
    listeners.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    monitor.stop();
    expect(listeners.size).toBe(0);
  });
});
