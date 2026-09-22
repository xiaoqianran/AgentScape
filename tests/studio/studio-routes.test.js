import { describe, expect, it } from 'vitest';
import {
  authoringWorldUrl,
  builtInWorldUrl,
  generatedArtifactWorldUrl,
  isProductNavigationActive,
  parseStudioRoute,
  studioProductUrl
} from '../../apps/studio/navigation/StudioRoutes.js';

describe('StudioRoutes',()=>{
  it('uses Worlds as the bare Studio landing page while preserving legacy direct-world links',()=>{
    expect(parseStudioRoute('http://127.0.0.1:5173/')).toMatchObject({page:'worlds',agentView:'tasks'});
    expect(parseStudioRoute('http://127.0.0.1:5173/?world=monument-hall')).toMatchObject({page:'world',worldId:'monument-hall'});
    expect(parseStudioRoute('http://127.0.0.1:5173/?mesh=/tmp/world.glb')).toMatchObject({page:'world',externalGenerated:true});
  });

  it('round-trips product and Agent subroutes without dropping current world context',()=>{
    const build=studioProductUrl('http://127.0.0.1:5173/?page=world&world=monument-hall',{page:'build'});
    expect(parseStudioRoute(build)).toMatchObject({page:'build',worldId:'monument-hall'});
    const runs=studioProductUrl(build,{page:'agent',agentView:'runs'});
    expect(parseStudioRoute(runs)).toMatchObject({page:'agent',agentView:'runs',worldId:'monument-hall'});
    const tasks=studioProductUrl(runs,{page:'agent',agentView:'tasks'});
    expect(new URL(tasks).searchParams.has('agent')).toBe(false);
  });

  it('encodes mutually exclusive built-in, generated-artifact and authoring editor routes',()=>{
    const builtin=builtInWorldUrl('http://127.0.0.1:5173/?page=worlds&worldArtifact=manifest_01&authoring=draft_01','ruined-courtyard');
    expect(parseStudioRoute(builtin)).toMatchObject({page:'world',worldId:'ruined-courtyard',worldArtifactId:null,authoringId:null});

    const generated=generatedArtifactWorldUrl(builtin,'manifest_02');
    expect(parseStudioRoute(generated)).toMatchObject({page:'world',worldId:null,worldArtifactId:'manifest_02',authoringId:null});

    const authored=authoringWorldUrl(generated,'draft_02');
    expect(parseStudioRoute(authored)).toMatchObject({page:'world',worldId:null,worldArtifactId:null,authoringId:'draft_02'});
  });

  it('keeps Worlds selected while a concrete World Editor child route is active',()=>{
    expect(isProductNavigationActive('worlds','worlds')).toBe(true);
    expect(isProductNavigationActive('world','worlds')).toBe(true);
    expect(isProductNavigationActive('world','build')).toBe(false);
  });
});
