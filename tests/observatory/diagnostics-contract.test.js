import {describe, expect, it} from 'vitest';
import {DIAGNOSTICS_SCHEMA, DIAGNOSTICS_VERSION, normalizeDiagnostics} from '../../apps/observatory/core/DiagnosticsContract.js';
import {INSPECTOR_PROFILES, inspectorProfileForLab} from '../../apps/observatory/ui/inspector/InspectorProfiles.js';
import {WORKSPACES} from '../../apps/observatory/core/WorkspaceRegistry.js';
import {DEBUG_LAYER_GROUPS} from '../../apps/observatory/ui/debugging/DebugLayerGroups.js';
import {projectLabTelemetry, renderingInfoForLab} from '../../apps/observatory/app/TelemetryAdapter.js';

describe('Observatory diagnostic contract', () => {
  it('provides a stable read-only diagnostic projection with safe defaults', () => {
    const data = normalizeDiagnostics();
    expect(data).toEqual({schema:DIAGNOSTICS_SCHEMA,version:DIAGNOSTICS_VERSION,inspector:null,metrics:{},assertions:[],capabilities:{gpu:false,tools:false,resources:false,layers:[]}});
  });
  it('copies telemetry and exposes capability declarations without mutating inputs', () => {
    const metrics={bodies:3}; const assertions=[{label:'ok',pass:true}]; const layers=['grid'];
    const data=normalizeDiagnostics({inspector:{title:'Physics',kind:'runtime',values:{bodies:3}},metrics,assertions,capabilities:{gpu:true,layers}});
    data.metrics.bodies=5; data.assertions.push({label:'extra'}); data.capabilities.layers.push('ray');
    expect(metrics.bodies).toBe(3); expect(assertions).toHaveLength(1); expect(layers).toEqual(['grid']);
  });
  it('defines distinct Lab profiles for all user-facing tools and legacy physics', () => {
    for (const workspace of WORKSPACES) for (const tool of workspace.tools) {
      expect(INSPECTOR_PROFILES[tool.id]).toBeDefined();
      expect(inspectorProfileForLab(tool.id).title).toBeTruthy();
    }
    expect(inspectorProfileForLab('physics').title).toBe('物理诊断');
    expect(inspectorProfileForLab('navigation').title).not.toBe(inspectorProfileForLab('spatial').title);
    expect(inspectorProfileForLab('rendering').gpu).toBe(true);
    expect(inspectorProfileForLab('physics-studio').gpu).toBe(false);
  });
  it('declares each debug layer in exactly one presentation group', () => {
    const layers=DEBUG_LAYER_GROUPS.flatMap((group)=>group[2]);
    expect(new Set(layers).size).toBe(layers.length);
    expect(layers).toContain('grid');
  });
  it('projects WebGPU telemetry without changing runtime measurements', () => {
    const input={metrics:{'physics.step':1.25}, assertions:[{label:'pass',pass:true}]};
    const projected=projectLabTelemetry(input,{renderer:'WebGPURenderer',backend:'webgpu',features:['subgroups'],limits:{maxStorageBufferBindingSize:134217728}});
    expect(projected.metrics['physics.step']).toBe(1.25);
    expect(projected.metrics['render backend']).toBe('webgpu');
    expect(projected.metrics['webgpu features']).toBe('subgroups');
    expect(projected.metrics['storage buffer']).toBe('128 MiB');
    expect(input.metrics).toEqual({'physics.step':1.25});
    expect(projected.diagnostics.version).toBe(DIAGNOSTICS_VERSION);
    expect(renderingInfoForLab({rendererProbe:{snapshot:()=>({backend:'webgpu'})}}).backend).toBe('webgpu');
  });
});
