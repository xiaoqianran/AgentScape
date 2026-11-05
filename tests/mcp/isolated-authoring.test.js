import { it, expect } from 'vitest';
import { createWorldAuthoringContext } from '../../application/createWorldAuthoringContext.js';
import { createIsolatedAuthoringExecutor } from '../../apps/mcp-server/IsolatedAuthoringExecutor.js';
import { validateRemoteAuthoringDocument } from '../../apps/mcp-server/RemoteAuthoringDocument.js';

it('isolates Three.js code, interrupts loops, rejects ambient access and unsupported content, and keeps the previous draft',async()=>{
 const executor=createIsolatedAuthoringExecutor({timeoutMs:250});
 const authoring=createWorldAuthoringContext({events:{emit(){}}},{executeCode:r=>executor.execute(r)});
 try {
  await authoring.run("const box=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshStandardMaterial({color:0xff0000}));box.name='authored-box';box.userData.authoringId='authored-box';scene.add(box);");
  const baseline=authoring.export();
  expect(baseline.root.children[0].name).toBe('authored-box');
  for(const code of ['while(true) {}','new ArrayBuffer(512*1024*1024);','process.env','fetch("http://127.0.0.1")','new Function("return process")()','onFrame(()=>{});','scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.ShaderMaterial()));']) {
   await expect(authoring.run(code)).rejects.toThrow();
   expect(authoring.export()).toEqual(baseline);
  }
  await authoring.run('scene.children[0].position.x=2;');
  expect(authoring.export().root.children[0].components.transform.properties.position[0]).toBe(2);
  const forged=structuredClone(authoring.export());
  forged.geometries[Object.keys(forged.geometries)[0]]={type:'SphereGeometry',parameters:{widthSegments:1e9}};
  expect(()=>validateRemoteAuthoringDocument(forged)).toThrow('AUTHORING_DOCUMENT_UNSUPPORTED');
  const oversizedGroup=structuredClone(baseline);
  Object.values(oversizedGroup.geometries)[0].json.data.groups=[{start:0,count:1e12,materialIndex:0}];
  expect(()=>validateRemoteAuthoringDocument(oversizedGroup)).toThrow();
  const external=structuredClone(baseline);
  external.textures={remote:{source:{type:'url',uri:'file:///secret'}}};
  expect(()=>validateRemoteAuthoringDocument(external)).toThrow();
  const textureCode="const texture=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);const mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshStandardMaterial({map:texture}));mesh.userData.authoringId='textured';scene.add(mesh);";
  await authoring.run(textureCode);
  const texture=Object.values(authoring.export().textures)[0];
  expect(texture.source.data).toEqual([255,0,0,255]);
 } finally {executor.close();authoring.dispose();}
},30000);
