// Lightweight startup milestones for repeatable browser performance comparisons.
// Read window.__agentScapeStartup in Playwright or DevTools; no external telemetry.
export function createStudioStartupMetrics({ clock = globalThis.performance, target = globalThis.window } = {}) {
  const entries = [];
  const origin = clock.now();
  if (target) target.__agentScapeStartup = entries;
  return {
    mark(stage) {
      const elapsedMs = Math.round((clock.now() - origin) * 10) / 10;
      entries.push({ stage, elapsedMs });
      clock.mark?.(`agentscape:studio:${stage}`);
      return elapsedMs;
    }
  };
}
