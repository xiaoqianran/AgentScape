import { describe, expect, it, vi } from 'vitest';
import { AgentTools } from '../src/agent/AgentTools.js';

const runtime = () => ({ events: { emit: vi.fn() }, listObjects: vi.fn(() => []), spawn: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), spatial: { getBounds: vi.fn(() => ({size:[1,1,1]})), findNearby: vi.fn(() => []), raycast: vi.fn(() => []), isColliding: vi.fn(() => []), getSupportSurface: vi.fn(() => null), findFreeSpace: vi.fn(() => null) }, interactions: { move: vi.fn(), pickup: vi.fn(), drop: vi.fn(), place: vi.fn(), setDoor: vi.fn() } });

describe('AgentTools', () => {
  it('rejects unknown tools', async () => { const tools = new AgentTools(runtime()); await expect(tools.call('destroyWorld', {})).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' }); });
  it('rejects missing required args', async () => { const tools = new AgentTools(runtime()); await expect(tools.call('moveObject', { id: 'a' })).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' }); });
  it('keeps the agent behind an explicit tool boundary', async () => { const r = runtime(); const tools = new AgentTools(r); await tools.call('open', { id: 'cabinet_01' }); expect(r.interactions.setDoor).toHaveBeenCalledWith('cabinet_01', true); });
  it('exposes spatial queries through the same boundary', async () => { const r = runtime(); const tools = new AgentTools(r); await tools.call('getBounds', { id: 'cup_01' }); await tools.call('findNearby', { id: 'cup_01', radius: 3 }); expect(r.spatial.getBounds).toHaveBeenCalledWith('cup_01'); expect(r.spatial.findNearby).toHaveBeenCalledWith('cup_01', 3); });
  it('exposes editor lifecycle operations through the same boundary', async () => { const r = runtime(); const tools = new AgentTools(r); await tools.call('duplicateObject', { id: 'cup_01' }); await tools.call('removeObject', { id: 'cup_01' }); expect(r.duplicate).toHaveBeenCalledWith('cup_01'); expect(r.remove).toHaveBeenCalledWith('cup_01'); });
});
