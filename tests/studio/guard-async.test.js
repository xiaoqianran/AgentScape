import { expect, it, vi } from 'vitest';
import { guardAsync } from '../../apps/studio/react/shared/guardAsync.ts';

it('reports synchronous UI command failures without throwing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(() => guardAsync('删除对象', () => { throw new Error('sync failure'); })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('删除对象');
  } finally { warn.mockRestore(); }
});

it('reports rejected asynchronous commands without unhandled rejections', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    guardAsync('保存草稿', async () => { throw new Error('async failure'); });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(warn.mock.calls[0][0]).toContain('保存草稿');
  } finally { warn.mockRestore(); }
});
