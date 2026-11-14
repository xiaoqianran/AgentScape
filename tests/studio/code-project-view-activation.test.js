import { describe, expect, it, vi } from 'vitest';
import { activateCodeProjectView } from '../../apps/studio/bootstrap/activateCodeProjectView.js';

const fixture = () => {
  const baseWorld = { id:'base' }, baseScene = { id:'base-scene' };
  const world = { id:'project' }, scene = { id:'project-scene' };
  const classes = new Set();
  const viewport = { classList:{
    contains:name=>classes.has(name),
    toggle:(name,enabled)=>enabled ? classes.add(name) : classes.delete(name)
  }};
  const projectHost = { hidden:true };
  const runtimeDriver = {
    running:true,
    stop:vi.fn(function () { this.running=false; }),
    start:vi.fn(function () { this.running=true; })
  };
  const liveBridge = { world:baseWorld, scene:baseScene };
  let selection = { source:'runtime', id:'selected' };
  const ui = {
    getSelection:()=>selection,
    setSelection:vi.fn(next=>{ selection=next; }),
    refreshInspector:vi.fn()
  };
  const activate = session => activateCodeProjectView({
    session, projectHost, viewport, runtimeDriver, liveBridge,
    baseWorld, baseScene, ui
  });
  return {activate, session:{world,scene}, projectHost, viewport, runtimeDriver, liveBridge, ui, baseWorld, baseScene,
    getSelection:()=>selection};
};

describe('Code project display transaction', () => {
  it('activates and returns to base world with matching driver and bridge state', () => {
    const f=fixture();
    f.activate(f.session);
    expect(f.projectHost.hidden).toBe(false);
    expect(f.viewport.classList.contains('has-code-project')).toBe(true);
    expect(f.runtimeDriver.running).toBe(false);
    expect(f.liveBridge.world).toBe(f.session.world);
    f.activate(null);
    expect(f.projectHost.hidden).toBe(true);
    expect(f.viewport.classList.contains('has-code-project')).toBe(false);
    expect(f.runtimeDriver.running).toBe(true);
    expect(f.liveBridge.world).toBe(f.baseWorld);
  });

  it('rolls back display, bridge and selection when the UI fails during activation', () => {
    const f=fixture();
    f.ui.refreshInspector.mockImplementationOnce(()=>{throw new Error('inspector failed');});
    expect(()=>f.activate(f.session)).toThrow('inspector failed');
    expect(f.projectHost.hidden).toBe(true);
    expect(f.viewport.classList.contains('has-code-project')).toBe(false);
    expect(f.runtimeDriver.running).toBe(true);
    expect(f.liveBridge.world).toBe(f.baseWorld);
    expect(f.liveBridge.scene).toBe(f.baseScene);
    expect(f.getSelection()).toEqual({source:'runtime',id:'selected'});
  });

  it('rolls back when returning from a project to the base view fails', () => {
    const f=fixture();
    f.activate(f.session);
    f.ui.refreshInspector.mockImplementationOnce(()=>{throw new Error('view failed');});
    expect(()=>f.activate(null)).toThrow('view failed');
    expect(f.projectHost.hidden).toBe(false);
    expect(f.viewport.classList.contains('has-code-project')).toBe(true);
    expect(f.runtimeDriver.running).toBe(false);
    expect(f.liveBridge.world).toBe(f.session.world);
  });
});
