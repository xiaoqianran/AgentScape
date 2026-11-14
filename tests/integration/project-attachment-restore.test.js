import { it, expect, vi } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';

function makeSession() {
  return createSession(null, { environmentFactory: () => createBlankWorld({ id: 'attachment-restore-lab' }) });
}
async function registerMachine(session) {
  await session.scene.addModel({ id:'device_01', asset:'builtin://table', position:[0,0,0] });
  session.scene.registerStateMachine({
    id:'device_01', attachTo:'runtime', initialState:{mode:'idle'},
    transitions:[{name:'activate', effects:[{field:'mode',op:'set',value:'active'}]}]
  });
}
async function activate(session) {
  const job=session.scene.interact({action:'invoke',target:'device_01',name:'activate',source:'project'});
  return session.scene.waitJob(job.id);
}

it('rebinds a live attached project machine after world and façade scene restores', async () => {
  const session=makeSession();
  await session.world.init();
  try {
    await registerMachine(session);
    const snapshot=session.world.serialize();
    const first=session.world.store.get('device_01');
    await session.world.restore(snapshot);
    expect(session.world.store.get('device_01')).not.toBe(first);
    expect(session.world.projectCapabilities.inspect('device_01').attachmentStatus).toBe('ready');
    expect(session.world.semantic.state('device_01','mode',{source:'project'})).toMatchObject({status:'known',value:'idle'});
    const facadeResult=await session.scene.restoreSnapshot(session.scene.snapshot());
    expect(facadeResult.status).not.toBe('failed');
    expect(session.world.projectCapabilities.inspect('device_01').attachmentStatus).toBe('ready');
    const completed=await activate(session);
    expect(completed).toMatchObject({status:'succeeded',result:{value:{verified:true,physicsVerified:false}}});
    expect(session.world.semantic.state('device_01','mode',{source:'project'})).toMatchObject({status:'known',value:'active'});
  } finally { session.scene.close(); session.world.dispose(); }
},30000);

it('never revives an attachment that went stale after ordinary object replacement', async () => {
  const session=makeSession();
  await session.world.init();
  try {
    await registerMachine(session);
    const assetId=session.world.store.get('device_01').assetId;
    session.world.remove('device_01');
    await session.world.spawn(assetId,{id:'device_01',position:[0,0,0]});
    expect(session.world.projectCapabilities.inspect('device_01').attachmentStatus).toBe('stale');
    await session.world.restore(session.world.serialize());
    expect(session.world.projectCapabilities.inspect('device_01').attachmentStatus).toBe('stale');
    expect(session.world.projectCapabilities.readState('device_01')).toBeNull();
  } finally { session.scene.close(); session.world.dispose(); }
},30000);

it('rebinds to the rolled-back world if a destructive restore fails', async () => {
  const session=makeSession();
  await session.world.init();
  try {
    await registerMachine(session);
    const snapshot=session.world.serialize();
    const spawn=vi.spyOn(session.world,'spawn').mockImplementationOnce(async () => {
      throw new Error('injected restore failure');
    });
    try { await expect(session.world.restore(snapshot)).rejects.toThrow('injected restore failure'); }
    finally { spawn.mockRestore(); }
    expect(session.world.projectCapabilities.inspect('device_01').attachmentStatus).toBe('ready');
    expect(session.world.semantic.state('device_01','mode',{source:'project'})).toMatchObject({status:'known',value:'idle'});
    expect((await activate(session)).status).toBe('succeeded');
  } finally { session.scene.close(); session.world.dispose(); }
},30000);
