import {describe,it,expect,vi} from 'vitest';
import {disposeLabProbes, applyLabDebugLayers, DEBUG_SETTERS} from '../../apps/observatory/app/LabLifecycle.js';
import {ToolWorkbenchMethods} from '../../apps/observatory/ui/workbench/ToolWorkbench.js';

describe('Observatory lifecycle and tools',()=>{
  it('releases each active probe once and clears its UI state',()=>{
    const remove=vi.fn(),dispose=vi.fn(),reset=vi.fn();
    const app={residentCullingProbe:{scene:{remove},result:{mesh:{},dispose}},indirectDrawProbe:null,compactionProbe:null,shell:{setResidentCullingResult:reset}};
    disposeLabProbes(app);disposeLabProbes(app);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(null);
    expect(app.residentCullingProbe).toBeNull();
  });
  it('maps enabled debug inputs to production lab setters',()=>{
    const setGridVisible=vi.fn(),setNativeDebug=vi.fn();
    applyLabDebugLayers({setGridVisible,setNativeDebug},{'grid-debug':{checked:true},'native-debug':{checked:false}});
    expect(setGridVisible).toHaveBeenCalledWith(true);
    expect(setNativeDebug).toHaveBeenCalledWith(false);
    expect(Object.keys(DEBUG_SETTERS).length).toBeGreaterThan(10);
  });
  it('maintains the existing tool-workbench interface',()=>{
    expect(['configureToolWorkbench','renderToolList','selectTool','invokeSelectedTool','renderToolHistory'].every(name=>typeof ToolWorkbenchMethods[name]==='function')).toBe(true);
  });
});
