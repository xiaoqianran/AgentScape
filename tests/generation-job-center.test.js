import { describe,expect,it } from 'vitest';
import { capabilityHint,generationJobActions,generationJobCenterMarkup,generationStatusLabel,parseGenerationInputs } from '../src/generation/GenerationJobCenter.js';

describe('Generation Job Center view model',()=>{
  it('parses only object-shaped generation inputs',()=>{
    expect(parseGenerationInputs('{"prompt":"chair"}')).toEqual({prompt:'chair'});
    expect(parseGenerationInputs('')).toEqual({});
    expect(()=>parseGenerationInputs('[1,2]')).toThrow(/object/);
    expect(()=>parseGenerationInputs('{bad')).toThrow(/JSON/);
  });

  it('keeps provider success separate from compile/spawn readiness',()=>{
    const job={jobId:'job_01',status:'provider-succeeded'};
    expect(generationJobActions(job)).toEqual({canRefresh:true,canCancel:false,canImport:true,canCompile:true,canSpawn:false,worldSpecEnabled:false});
    expect(generationJobActions(job,{status:'asset-provisional'}).canSpawn).toBe(true);
    expect(generationJobActions(job,{status:'asset-rejected'}).canSpawn).toBe(false);
  });

  it('renders declared capability hints without inventing price or duration',()=>{
    const hint=capabilityHint({operation:'modal-3d.asset.text_to_3d.v1',input:{types:['text']},execution:{durationClass:'long',costClass:'gpu'},connectionRequired:true});
    expect(hint).toContain('duration long');
    expect(hint).toContain('cost gpu');
    expect(hint).toContain('Connector session required');
    expect(hint).not.toMatch(/\$|USD|minutes/i);
  });


  it('keeps import, compile/register, spawn, and WorldSpec as separate product actions',()=>{
    const markup=generationJobCenterMarkup();
    expect(markup).toContain('id="generation-job-import"');
    expect(markup).toContain('id="generation-job-compile"');
    expect(markup).toContain('id="generation-job-spawn"');
    expect(markup).toContain('id="generation-job-worldspec"');
    expect(markup).toContain('id="generation-cost-confirm"');
    expect(markup).toMatch(/generation-job-worldspec[^>]*disabled/);
  });

  it('uses human labels without upgrading truth',()=>{
    expect(generationStatusLabel('generation-pending')).toBe('生成中');
    expect(generationStatusLabel('provider-succeeded')).toBe('Provider 已完成');
  });
});
