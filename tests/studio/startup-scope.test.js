import { describe, expect, it, vi } from 'vitest';
import { createStudioStartupScope } from '../../apps/studio/bootstrap/createStudioStartupScope.js';

describe('Studio bootstrap lifecycle', () => {
  it('rolls back resources in reverse order after partial initialization', () => {
    const calls = [];
    const scope = createStudioStartupScope();
    scope.add(() => calls.push('UI'));
    scope.add({ dispose:() => calls.push('Runtime') });
    scope.add({ dispose:() => calls.push('Agent') });
    scope.dispose();
    scope.dispose();
    expect(calls).toEqual(['Agent','Runtime','UI']);
    expect(() => scope.add(() => {})).toThrow('STUDIO_STARTUP_SCOPE_DISPOSED');
  });

  it('continues releasing remaining resources when one cleanup fails', () => {
    const calls = [];
    const onDisposeError = vi.fn();
    const scope = createStudioStartupScope({ onDisposeError });
    scope.add(() => calls.push('UI'));
    scope.add(() => { throw new Error('release failed'); });
    scope.add(() => calls.push('Workspace'));
    scope.dispose();
    expect(calls).toEqual(['Workspace','UI']);
    expect(onDisposeError).toHaveBeenCalledOnce();
    expect(onDisposeError.mock.calls[0][0].message).toBe('release failed');
  });
});
