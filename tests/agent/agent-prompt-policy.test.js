import { describe,expect,it } from 'vitest';
import { buildAgentSystemPrompt } from '../../agent/prompt/index.js';

describe('Agent prompt policy composition',()=>{
  it('derives the available tool surface from structured definitions instead of a hidden hard-coded tool list',()=>{
    const prompt=buildAgentSystemPrompt([{name:'searchAssets'},{name:'runWorldPipeline'}]);
    expect(prompt).toContain('searchAssets, runWorldPipeline');
    expect(prompt).toContain('tool JSON schemas, and tool descriptions are authoritative');
    expect(prompt).not.toContain('importEmbodiedGenAsset');
    expect(prompt).not.toContain('modal-2d');
  });
  it('keeps mutation, recovery, world-admission, and embodied execution invariants explicit',()=>{
    const prompt=buildAgentSystemPrompt([]);
    for(const invariant of ['fresh planning round','one recovery mutation','world-provisional remains unverified','approachAndInteract','approachAndPlace']) expect(prompt).toContain(invariant);
  });
});
