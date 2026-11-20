import { createHash } from 'node:crypto';

const check=(id,kind,rest={})=>({id:'task-'+id,kind,...rest});
const entity=(id)=>check('entity-'+id,'object-exists',{targetId:id});
const action=(id,name,source='project')=>check('action-'+id+'-'+name,'interaction-verified',{
  targetId:id,capability:name.toUpperCase(),source
});
const relation=(name,subject,predicate,object)=>check('relation-'+name,'relation-exists',{
  subject,predicate,object
});
const limit=12;

/** A deliberately narrow, deterministic compiler: only user text can establish requirements.
 * Unknown language/tasks are flagged for review, never replaced with the model's own criteria.
 */
export function compileTaskSpec(prompt) {
  if(typeof prompt!=='string' || !prompt.trim()) throw new TypeError('TASK_PROMPT_REQUIRED');
  const goalHash=createHash('sha256').update(prompt).digest('hex');
  const checks=[];
  let template='unclassified',reviewReason='TASK_SPEC_REVIEW_REQUIRED';
  let visualRequired=/(美观|漂亮|逼真|精致|外观|视觉|realistic|beautiful|visually|appearance)/i.test(prompt);

  if(/苹果树|apple[ -]?tree/i.test(prompt)){
    template='apple-tree';reviewReason=null;
    checks.push(entity('apple_tree'));
    const english=prompt.match(/\b(\d{1,2})\s+apples?\b/i);
    const chinese=prompt.match(/(\d{1,2}|[一二三四五六七八九十])\s*(?:颗|个)?\s*苹果/);
    const chineseNumbers={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    const number=english ? Number(english[1]) : chinese
      ? Number(chinese[1])||chineseNumbers[chinese[1]] : null;
    if(number!==null && (!Number.isSafeInteger(number)||number<1||number>limit)){
      reviewReason='TASK_SPEC_COUNT_UNSUPPORTED';
    } else if(number){
      for(let n=1;n<=number;n++)checks.push(entity('apple_'+String(n).padStart(2,'0')));
    } else {
      // A tree with no fruit should not pass the minimum structural acceptance.
      checks.push(entity('apple_01'));
    }
    if(/(?:可摘|采摘|摘取|摘下|pluck|pick)/i.test(prompt))checks.push(action('apple_tree','pluck'));
  } else if(/房屋|房子|小屋|(?:\bhouse\b)|\bcottage\b/i.test(prompt)){
    template='house';reviewReason=null;
    checks.push(entity('house'));
    if(/门|\bdoor\b/i.test(prompt))checks.push(entity('door_01'));
    if(/窗|\bwindow\b/i.test(prompt))checks.push(entity('window_01'));
    if(/楼梯|\bstair/i.test(prompt))checks.push(entity('stairs'));
    if(/(?:可开|打开|开门|open)\s*(?:门|door)?/i.test(prompt)&&/门|\bdoor\b/i.test(prompt))
      checks.push(action('door_01','open'));
  } else if(/杯(?:子)?|\bcup\b/i.test(prompt)){
    template='cup';reviewReason=null;
    checks.push(entity('cup_01'));
    const hasTable=/桌|\btable\b/i.test(prompt);
    if(hasTable)checks.push(entity('table_01'));
    if(hasTable&&/放|摆放|put|place/i.test(prompt))
      checks.push(relation('cup-on-table','cup_01','ON','table_01'));
    if(/拿取|拾取|拿起|pickup|pick up/i.test(prompt))checks.push(action('cup_01','pickup','physical-articulation'));
  }
  // Only fully understood, versioned golden task sentences can be automatically
  // accepted. A partial natural-language match must never silently discard extra
  // user requirements (such as a lift, lighting or custom interactions).
  const knownPrompts=new Set([
    ...GOLDEN_TASKS.map(item=>item.prompt),
    '在当前世界添加苹果树',
    '创建漂亮的苹果树，带5个苹果，可以摘取'
  ]);
  if(!knownPrompts.has(prompt.trim()) && !reviewReason)
    reviewReason='TASK_SPEC_REVIEW_REQUIRED';  return Object.freeze({
    schema:'agentscape.task-spec',schemaVersion:1,id:'task-'+goalHash.slice(0,16),
    source:'user-prompt',template,status:reviewReason?'review-required':'ready',
    ...(reviewReason?{reason:reviewReason}:{}),
    requiredChecks:checks,visual:{required:visualRequired,status:'not-evaluated'}
  });
}

/** Model calls cannot edit this specification or choose weaker postconditions. */
export function requiredTaskCriteria(spec) {
  if(spec?.schema!=='agentscape.task-spec'||spec.schemaVersion!==1||spec.status!=='ready')
    return [];
  return structuredClone(spec.requiredChecks);
}

export const GOLDEN_TASKS=Object.freeze([
  {id:'apple-tree',prompt:'创建一棵有5个苹果、可以摘取苹果的苹果树'},
  {id:'house',prompt:'创建带门、窗户和楼梯的房屋'},
  {id:'cup',prompt:'把杯子放到桌子上'}
]);
