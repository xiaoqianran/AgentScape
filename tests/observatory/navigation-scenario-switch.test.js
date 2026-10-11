import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';
import {NavigationLab} from '../../apps/observatory/labs/navigation/NavigationLab.js';
import {NavigationScenarioContext} from '../../apps/observatory/labs/navigation/NavigationScenarioContext.js';
import {ScenarioRunner} from '../../apps/observatory/core/ScenarioRunner.js';
import {SimulationClock} from '../../apps/observatory/core/SimulationClock.js';
import {navigationGapScenario} from '../../apps/observatory/labs/navigation/scenarios/gapPath.js';
import {navigationDoorCounterfactualScenario} from '../../apps/observatory/labs/navigation/scenarios/doorCounterfactual.js';

describe('NavigationLab scene switching',()=>{
  it('refreshes the route and debug mesh when gap and Rapier door scenes share a revision number',async()=>{
    const lab=Object.create(NavigationLab.prototype);
    lab.scene=new THREE.Scene();
    lab.clock=new SimulationClock();
    lab.runner=new ScenarioRunner({clock:lab.clock,createContext:()=>new NavigationScenarioContext({scene:lab.scene}).init()});
    lab.cameraRig={moveTo:vi.fn()};
    lab.worldLabels={setLabels:vi.fn()};
    lab.debugRenderer={update:vi.fn()};
    lab.onTelemetry=vi.fn();
    try {
      await lab.load(navigationGapScenario);
      const gap=lab.lastDebugSnapshot;
      expect(gap.route.reachable).toBe(true);
      const revisions=lab.runner.context.debugRevision;
      await lab.load(navigationDoorCounterfactualScenario);
      const door=lab.runner.context.debugSnapshot();
      // The same revision value is allowed for *distinct* context instances.
      expect(lab.runner.context.debugRevision).toBe(revisions);
      expect(lab.lastDebugSnapshot.route.reachable).toBe(false);
      expect(lab.lastDebugSnapshot.physicsObstacles.items).toHaveLength(1);
      expect(lab.lastDebugSnapshot).toMatchObject({route:{reason:door.route.reason}});
      expect(lab.debugRenderer.update).toHaveBeenCalledTimes(2);
      await lab.load(navigationGapScenario);
      expect(lab.lastDebugSnapshot.route.reachable).toBe(true);
      expect(lab.debugRenderer.update).toHaveBeenCalledTimes(3);
    } finally { await lab.runner.dispose(); }
  });
});
