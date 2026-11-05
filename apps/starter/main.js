import { AgentScape } from '../../sdk/typescript/src/index.ts';
import project from './scene.json';
import './style.css';

const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
const setBusy = value => buttons.forEach(button => { button.disabled = value; });
let scene;
let frameId;
let chairId;
let chairIndex = 0;
const updateCount = () => { document.querySelector('#count').textContent = `${scene.observe().objects.length} objects`; };
async function run(operation) {
  setBusy(true);
  status.textContent = 'Working in the world…';
  try { status.textContent = await operation(); updateCount(); }
  catch (error) { status.textContent = `${error.code || 'ERROR'}: ${error.message}`; }
  finally { setBusy(false); }
}
const describe = (result, message) => result.verification.status === 'verified' ? message : `Not verified: ${result.value?.status || result.status}. Try opening the original scene again.`;
const interact = async input => (await scene.waitJob(scene.interact(input).id)).result;
try {
  scene = await AgentScape.open({ autoStart: false, canvas: '#viewport', project: {
    schema: 'agentscape.scene-project', schemaVersion: 1, name: project.name,
    environment: { type: 'builtin', id: 'monument-hall' },
    objects: project.objects.map(object => ({ id: object.id, asset: 'builtin://' + object.asset, level: 'physical', transform: { position: object.position } }))
  } });
  const frame = timestamp => {
    try { scene.frame(timestamp); frameId = requestAnimationFrame(frame); }
    catch (error) { setBusy(true); status.textContent = `Rendering stopped: ${error.message}`; }
  };
  frameId = requestAnimationFrame(frame);
  updateCount();
  status.textContent = 'Ready. Start by picking up the cup.';
  setBusy(false);
  document.querySelector('#pickup').onclick = () => run(async () => describe(await interact({ action: 'pickup', actor: 'helper', target: 'mug' }), 'Verified: the helper is holding the cup.'));
  document.querySelector('#place').onclick = () => run(async () => describe(await interact({ action: 'place', actor: 'helper', target: 'desk', surfaceId: 'top' }), 'Verified: the cup is settled on the table.'));
  document.querySelector('#add').onclick = () => run(async () => {
    const nextId = `chair_${chairIndex + 1}`;
    await scene.addModel({ id: nextId, asset: 'builtin://chair', position: [-4, 0, 3 + chairIndex * 1.2] });
    chairIndex++;
    chairId = nextId;
    return 'Chair added. Use “Move the chair” to edit its position.';
  });
  document.querySelector('#move').onclick = () => run(async () => {
    if (!chairId) return 'Add a chair first.';
    await scene.setTransform({ id: chairId, transform: { position: [-3, 0, 6] } });
    return 'Chair moved; its physics body follows the edit.';
  });
  document.querySelector('#save').onclick = () => run(async () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify((await scene.save()).value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'my-world.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'World downloaded. Open it here after reloading to restore your objects.';
  });
  document.querySelector('#restore').onclick = () => document.querySelector('#file').click();
  document.querySelector('#file').onchange = event => run(async () => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return 'No file selected.';
    if (file.size > 256 * 1024) throw new Error('Save must be smaller than 256 KiB.');
    const next = await AgentScape.open({ bundle: JSON.parse(await file.text()), canvas: '#viewport', autoStart: false });
    try { scene.close(); } catch (error) { next.close(); throw error; }
    scene = next;
    const result = { objects: scene.observe().objects.length };
    chairId = undefined;
    chairIndex = Math.max(0, ...scene.observe().objects.map(o => /^chair_(\d+)$/.exec(o.id)?.[1]).filter(Boolean).map(Number));
    return `Restored ${result.objects} objects. Previous action evidence is not reused.`;
  });
} catch (error) { status.textContent = `Unable to start: ${error.message}. Check browser WebGL support and reload.`; }
