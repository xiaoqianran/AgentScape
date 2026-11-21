/**
 * Real-provider TaskCompiler smoke benchmark.
 * Usage: node dev/evaluate-task-compiler.mjs
 * No prompt/response bodies, tokens, URL or credentials are printed.
 */
import { loadPrivateEnv,getConfig } from '../apps/agent-host/AgentHost.mjs';
import { compileTaskSpecWithModel } from '../apps/agent-host/TaskCompiler.js';

loadPrivateEnv('.env.local');
const configuration=getConfig(process.env);
if(!configuration.baseUrl||!configuration.apiKey||!(configuration.taskCompilerModelId||configuration.modelId))
  throw new Error('TASK_COMPILER_MODEL_CONFIGURATION_REQUIRED');

const cases=[
  {id:'car',prompt:'创建一辆有四个轮子的汽车，车门能够打开',objects:5,action:true},
  {id:'castle',prompt:'创建一座城堡，有两座塔楼和一个大门',objects:4},
  {id:'garden',prompt:'创建一座花园，里面有三棵树和一座喷泉',objects:5},
  {id:'factory',prompt:'创建一个工厂，里面有两台机器，可以启动机器',objects:3,action:true},
  {id:'cup',prompt:'在桌子上放一个杯子',objects:2,relation:true},
  {id:'bridge',prompt:'创建一座漂亮的桥，横跨河流，夜间有灯光',objects:2,visual:true},
  {id:'elevator',prompt:'创建带电梯的房屋，电梯可以上下移动',objects:2,action:true},
  {id:'robot',prompt:'创建一台精致的机器人，双臂可以旋转',objects:1,action:true,visual:true},
  {id:'drone',prompt:'创建一架无人机，有四个螺旋桨，可以飞行',objects:5,action:true},
  {id:'playground',prompt:'Build a playground with two swings and a slide',objects:4}
];
const limit=Number(process.env.AGENTSCAPE_TASK_COMPILER_BENCH_LIMIT||cases.length);
if(!Number.isSafeInteger(limit)||limit<1||limit>cases.length)
  throw new Error('INVALID_BENCHMARK_LIMIT');
const results=[];
for(const item of cases.slice(0,limit)){
  const started=performance.now();
  const spec=await compileTaskSpecWithModel(item.prompt,{configuration,timeoutMs:18000});
  const checks=spec.requiredChecks||[];
  const objectCount=checks.filter(check=>check.kind==='object-exists').length;
  const actionCount=checks.filter(check=>check.kind==='interaction-verified').length;
  const relationCount=checks.filter(check=>check.kind==='relation-exists').length;
  const basicCoverage=objectCount>=item.objects && (!item.action||actionCount>0) &&
    (!item.relation||relationCount>0) && (!item.visual||spec.visual.required);
  const result={id:item.id,elapsedMs:Math.round(performance.now()-started),
    status:spec.status,diagnosticCode:spec.compilation?.diagnosticCode||null,
    basicCoverage,objects:objectCount,actions:actionCount,relations:relationCount,visual:spec.visual.required};
  results.push(result);
  console.log(JSON.stringify(result));
}
const total=results.length;
const count=predicate=>results.filter(predicate).length;
console.log('SUMMARY '+JSON.stringify({total,ready:count(x=>x.status==='ready'),
  reviewRequired:count(x=>x.status==='review-required'),
  unavailable:count(x=>x.diagnosticCode!==null),
  basicCoverage:count(x=>x.basicCoverage),
  potentialFalseReady:count(x=>x.status==='ready'&&!x.basicCoverage),
  elapsedMs:results.reduce((sum,x)=>sum+x.elapsedMs,0)}));
