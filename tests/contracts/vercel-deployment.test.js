import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('vercel.json'));
const workflow = read('.github/workflows/production-smoke.yml');
const smokeScript = read('dev/check-production-smoke.mjs');

const entries = [
  ['/', 'index.html', '<title>AgentScape</title>'],
  ['/studio/', 'index.html', '<title>AgentScape</title>'],
  ['/home/', 'apps/spline-home/index.html', '<title>AgentScape Home</title>'],
  ['/starter/', 'apps/starter/index.html', '<title>AgentScape · First world</title>'],
  ['/observatory/', 'apps/observatory/index.html', '<title>AgentScape Observatory</title>'],
  ['/examples/code-project/', 'examples/code-project/index.html', '<title>自由代码世界 · AgentScape</title>'],
  ['/examples/native-scene/', 'examples/native-scene/index.html', '<title>原生 Three.js · AgentScape</title>'],
  ['/examples/three-code/', 'examples/three-code/index.html', '<title>AgentScape code assets</title>']
];

describe('Vercel deployment matches current Studio multi-page environment', () => {
  it('publishes each Vite entrypoint and delegates smoke checks to the actual script', () => {
    expect(config.framework).toBe('vite');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('dist');
    expect(workflow).toContain('run: node dev/check-production-smoke.mjs');
    for (const [route, source, title] of entries) {
      expect(read(source)).toContain(title);
      // The workflow delegates route checks to a testable Node script.
      expect(smokeScript).toContain("['" + route + "', '" + title.slice(7, -8) + "']");
    }
    expect(smokeScript).toContain('SMOKE_JS_BUNDLE_MISSING');
    expect(smokeScript).toContain('fetchOrFail(base,script,fetchFn)');
  });

  it('has stable redirect aliases and does not rewrite API functions to static HTML', () => {
    for (const [source, destination] of Object.entries({
      '/studio': '/studio/',
      '/code-project': '/examples/code-project/',
      '/native-scene': '/examples/native-scene/',
      '/three-code': '/examples/three-code/'
    })) {
      expect(config.redirects).toContainEqual({ source, destination, permanent: source === '/studio' });
    }
    expect(config.rewrites || []).toEqual([]);
    expect(read('api/capabilities/index.js')).toContain('sendCapabilityStatus');
    expect(read('api/capabilities/health.js')).toContain('sendCapabilityHealth');
  });

  it('keeps volatile adapter status responses uncached and their credentials out of build config', () => {
    for (const route of ['/api/capabilities', '/api/capabilities/:path*']) {
      const rule = config.headers.find(item => item.source === route);
      expect(rule?.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
    }
    expect(JSON.stringify(config)).not.toMatch(/(API_KEY|AUTHORIZATION|SECRET|TOKEN)/);
    expect(smokeScript).toContain("['/api/capabilities','/api/capabilities/health']");
  });
});
