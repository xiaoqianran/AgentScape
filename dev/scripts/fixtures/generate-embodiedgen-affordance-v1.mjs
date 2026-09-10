import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Document, Primitive, WebIO } from '@gltf-transform/core';

const outDir=resolve('tests/fixtures/embodiedgen-affordance-v1');
await mkdir(outDir,{recursive:true});
const enc=new TextEncoder();
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');

const document=new Document();
const buffer=document.createBuffer('buffer');
// Four spatially separated 3-triangle patches.  Each triangle owns its vertices so
// face order is explicit and stable while still exercising one indexed primitive.
const positions=[];
const indices=[];
for(let part=0;part<4;part++){
  const x=part*1.5;
  const triangles=[
    [[x,0,0],[x+1,0,0],[x+.5,.8,0]],
    [[x,0,0],[x+.5,.8,0],[x+.2,.3,.6]],
    [[x+1,0,0],[x+.2,.3,.6],[x+.5,.8,0]],
  ];
  for(const tri of triangles){
    const base=positions.length/3;
    for(const vertex of tri) positions.push(...vertex);
    indices.push(base,base+1,base+2);
  }
}
const positionAccessor=document.createAccessor('POSITION').setType('VEC3').setBuffer(buffer).setArray(new Float32Array(positions));
const indexAccessor=document.createAccessor('indices').setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array(indices));
const primitive=document.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setAttribute('POSITION',positionAccessor).setIndices(indexAccessor);
const mesh=document.createMesh('EmbodiedGenFixtureMesh').addPrimitive(primitive);
const node=document.createNode('geometry_0').setMesh(mesh);
const scene=document.createScene('Scene').addChild(node);
document.getRoot().setDefaultScene(scene);
const glb=new Uint8Array(await new WebIO().writeBinary(document));
await writeFile(resolve(outDir,'sample_00.glb'),glb);

const faceLabels=['0','0','0','1','1','1','2','2','2','3','3','3'];
const segmentation={
  version:1,
  source:'embodiedgen/p3sam',
  faceCount:12,
  segments:[0,1,2,3].map((id)=>({id:String(id),faceCount:3})),
  artifact:{
    role:'primary_glb',
    path:'source/sample_00.glb',
    sha256:sha256(glb),
    bytes:glb.byteLength,
    sourceObjSha256:'f'.repeat(64),
    alignment:{strategy:'verified-vertex-identity-triangle-index-set',maxVertexAbsError:0},
  },
  materialization:{sourceNode:'geometry_0',primitives:[{primitive:0,faceLabels}]},
};
const segmentationBytes=enc.encode(JSON.stringify(segmentation,null,2)+'\n');
await writeFile(resolve(outDir,'agentscape_part_segmentation.v1.json'),segmentationBytes);

const rawGrasps={
  version:1,
  source_job_id:'job-11111111111111111111111111111111',
  output_job_id:'job-22222222222222222222222222222222',
  backend:'GraspGen',
  evidence_level:'raw',
  gripper:'franka_panda',
  source_frame:'urdf_link:sample_00',
  seed:42,
  grasps:[
    {rank:0,score:.82,pose:[[1,0,0,.25],[0,1,0,.1],[0,0,1,.3],[0,0,0,1]]},
    {rank:1,score:.71,pose:[[0,-1,0,1.7],[1,0,0,.2],[0,0,1,.25],[0,0,0,1]]},
    {rank:2,score:.63,pose:[[1,0,0,4.6],[0,0,-1,.15],[0,1,0,.2],[0,0,0,1]]},
  ],
};
const rawGraspBytes=enc.encode(JSON.stringify(rawGrasps,null,2)+'\n');
await writeFile(resolve(outDir,'raw_grasps.franka.v1.json'),rawGraspBytes);

const partSemantics={
  version:1,
  source:'embodiedgen/gpt-part-semantics',
  profile:'part-semantics-v1',
  sourceJobId:'job-11111111111111111111111111111111',
  outputJobId:'job-22222222222222222222222222222222',
  input:{
    manifestSha256:'e'.repeat(64),
    segmentationSha256:sha256(segmentationBytes),
    rgbGridSha256:'a'.repeat(64),
    maskGridSha256:'b'.repeat(64),
    partAtlasSha256:'c'.repeat(64),
  },
  provenance:{
    apiStyle:'openai-compatible',
    model:'meta/muse-glimmer-30b',
    promptRevision:'c2fe6c8c8868270e73443d47ef35b56ec17b0432a2c40f1fd9a5ca9514786621',
    requestIds:['fixture-request-id'],
    attempts:1,
  },
  parts:[
    {id:'0',mask_color:'Red',part_name:'handle',graspable:true,grasp_scenarios:[{scenario:'grasp handle',confidence:.9}],functional_labels:['provide grip'],semantic_description:'Handle-like region.'},
    {id:'1',mask_color:'Green',part_name:'rim',graspable:false,grasp_scenarios:[],functional_labels:['bound opening'],semantic_description:'Upper rim region.'},
    {id:'2',mask_color:'Yellow',part_name:'body',graspable:true,grasp_scenarios:[{scenario:'grasp body',confidence:.7}],functional_labels:['support object'],semantic_description:'Main body region.'},
    {id:'3',mask_color:'Blue',part_name:'base',graspable:false,grasp_scenarios:[],functional_labels:['support placement'],semantic_description:'Bottom support region.'},
  ],
};
const partSemanticBytes=enc.encode(JSON.stringify(partSemantics,null,2)+'\n');
await writeFile(resolve(outDir,'part_semantics.v1.json'),partSemanticBytes);

const urdf=`<?xml version="1.0"?>\n<robot name="embodiedgen_fixture">\n  <link name="base">\n    <visual><geometry><mesh filename="source/sample_00.glb"/></geometry></visual>\n  </link>\n</robot>\n`;
const urdfBytes=enc.encode(urdf);
await writeFile(resolve(outDir,'sample_00.urdf'),urdfBytes);

const descriptor=(id,role,mediaType,fileName,bytes)=>({id,role,mediaType,sha256:sha256(bytes),bytes:bytes.byteLength,fileName,path:fileName});
const bundle={
  version:1,
  provider:'embodiedgen',
  sourceJobId:'job-11111111111111111111111111111111',
  asset:{id:'embodiedgen_frozen_affordance_v1',label:'EmbodiedGen frozen affordance v1'},
  lineage:{
    modalBuildCommit:'adf9fcf',
    embodiedGenCommit:'cc3015ca5ccdacf94df3428d9e65f79375982216',
    workflow:'asset.affordance',
    workflowVersion:'part-evidence-only',
    seed:42,
  },
  artifacts:[
    descriptor('primary','primary_glb','model/gltf-binary','sample_00.glb',glb),
    descriptor('urdf','source_urdf','application/xml','sample_00.urdf',urdfBytes),
    descriptor('segmentation','part_segmentation','application/vnd.agentscape.part-segmentation+json','agentscape_part_segmentation.v1.json',segmentationBytes),
    descriptor('raw-grasps','raw_grasps','application/json','raw_grasps.franka.v1.json',rawGraspBytes),
  ],
};
const bundleBytes=enc.encode(JSON.stringify(bundle,null,2)+'\n');
await writeFile(resolve(outDir,'bundle.v1.json'),bundleBytes);

const semanticBundle={
  ...bundle,
  lineage:{...bundle.lineage,modalBuildCommit:'eda84b7',workflowVersion:'semantic-evidence-v1'},
  artifacts:[
    ...bundle.artifacts,
    descriptor('semantics','part_semantics','application/json','part_semantics.v1.json',partSemanticBytes),
  ],
};
const semanticBundleBytes=enc.encode(JSON.stringify(semanticBundle,null,2)+'\n');
await writeFile(resolve(outDir,'bundle.semantic.v1.json'),semanticBundleBytes);

const expected={
  fixtureVersion:1,
  contractSource:'modal-build@adf9fcf',
  consumerBaseline:'AgentScape@671e1ac',
  primaryGlbSha256:sha256(glb),
  segmentationSha256:sha256(segmentationBytes),
  rawGraspsSha256:sha256(rawGraspBytes),
  partSemanticsSha256:sha256(partSemanticBytes),
  bundleSha256:sha256(bundleBytes),
  semanticBundleSha256:sha256(semanticBundleBytes),
  faceCount:12,
  partCount:4,
  rawGraspCount:3,
  expectedMaterializedNodes:['geometry_0__part_0','geometry_0__part_1','geometry_0__part_2','geometry_0__part_3'],
  expectedSemanticByPart:{'0':'handle','1':'rim','2':'body','3':'base'},
  expectedQuality:'provisional',
  expectedAdmissionReasons:['PART_SEMANTICS_UNVERIFIED','PROVIDER_GRASP_RAW_ONLY','PART_PROPOSAL_PARTIAL','COLLIDER_COARSE','SEMANTIC_LOW_CONFIDENCE'],
};
await writeFile(resolve(outDir,'expected.json'),JSON.stringify(expected,null,2)+'\n');
console.log(JSON.stringify({outDir,files:8,glbBytes:glb.byteLength,bundleSha256:expected.bundleSha256,semanticBundleSha256:expected.semanticBundleSha256},null,2));
