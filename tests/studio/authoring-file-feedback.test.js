import { describe, expect, it, vi } from 'vitest';
import { bindAuthoringWorldControls } from '../../apps/studio/authoring/bindAuthoringWorldControls.js';

function setup(options={}) {
 const controller={
  status:()=>({id:null,name:'Untitled World',dirty:false,persisted:false}),
  list:vi.fn(async()=>[]),isDirty:()=>false,
  newWorld:vi.fn(async()=>({id:null})),openWorld:vi.fn(async()=>({id:'draft'})),
  save:vi.fn(async()=>({id:'draft',name:'Draft'})),saveAs:vi.fn(async()=>({id:'draft',name:'Draft'})),
  ...options
 };
 return {controller,view:bindAuthoringWorldControls({controller,log:vi.fn(),confirmImpl:()=>false})};
}

describe('Authoring file operation feedback',()=>{
 it('exposes a failed create to the view instead of reporting only to logs',async()=>{
  const {view}=setup({newWorld:vi.fn(async()=>{throw new Error('storage unavailable')})});
  try { expect(await view.createNew()).toBeNull();expect(view.snapshot().fileError).toContain('storage unavailable'); }
  finally {view.dispose()}
 });
 it('distinguishes a cancelled discard from an operation failure',async()=>{
  const {view,controller}=setup({isDirty:()=>true});
  try {expect(await view.createNew()).toBeNull();expect(controller.newWorld).not.toHaveBeenCalled();expect(view.snapshot().fileError).toBe('');}
  finally {view.dispose()}
 });
 it('clears a previous file error after a successful retry',async()=>{
  const open=vi.fn().mockRejectedValueOnce(new Error('missing file')).mockResolvedValueOnce({id:'draft'});
  const {view}=setup({openWorld:open});
  try {await view.open('draft');expect(view.snapshot().fileError).toContain('missing file');expect(await view.open('draft')).toEqual({id:'draft'});expect(view.snapshot().fileError).toBe('');}
  finally {view.dispose()}
 });
});
