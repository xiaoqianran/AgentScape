import { meta, string } from '../skillPrimitives.js';

import { diffAuthoringDocuments } from '../../world-authoring/AuthoringDiff.js';

const MAX_AUTHORING_CODE_LENGTH = 131072;
const MAX_DIFF_NODE_SUMMARY = 64;

// Fail-closed static guards. The authoring sandbox exposes THREE and the authoring
// surface only; ambient browser/server capabilities must stay unreachable by name.
const FORBIDDEN_API_PATTERN = new RegExp(
  [
    '\\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|postMessage',
    '|localStorage|sessionStorage|indexedDB|caches',
    '|navigator|location|window|document|globalThis',
    '|eval|Function|process|require)\\b',
    '|\\bimport\\s*\\('
  ].join(''),
  'g'
);

export function validateAuthoringCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok:false, code:'AUTHORING_CODE_REQUIRED', message:'Authoring code must be a non-empty string.' };
  }
  if (code.length > MAX_AUTHORING_CODE_LENGTH) {
    return { ok:false, code:'AUTHORING_CODE_TOO_LARGE', message:`Authoring code exceeds ${MAX_AUTHORING_CODE_LENGTH} characters.` };
  }
  FORBIDDEN_API_PATTERN.lastIndex = 0;
  const match = FORBIDDEN_API_PATTERN.exec(code);
  if (match) {
    return {
      ok:false,
      code:'AUTHORING_CODE_FORBIDDEN_API',
      message:`Authoring code must not reference ambient capabilities (${match[0].trim()}). Only THREE, scene, clear, onFrame and modelRef are available in the sandbox.`
    };
  }
  return { ok:true };
}

const summarizeNodes = (entries) => entries
  .slice(0, MAX_DIFF_NODE_SUMMARY)
  .map((entry) => ({
    id:entry.id,
    ...(entry.node?.name ? { name:entry.node.name } : {}),
    ...(entry.node?.type ? { type:entry.node.type } : {})
  }));

export function summarizeAuthoringDiff(diff) {
  return {
    empty:diff.empty === true,
    nodes:{
      added:summarizeNodes(diff.nodes?.added || []),
      removed:(diff.nodes?.removed || []).slice(0, MAX_DIFF_NODE_SUMMARY).map((entry)=>entry.id),
      updated:(diff.nodes?.updated || []).slice(0, MAX_DIFF_NODE_SUMMARY).map((entry)=>entry.id),
      moved:(diff.nodes?.moved || []).slice(0, MAX_DIFF_NODE_SUMMARY).map((entry)=>entry.id)
    },
    resources:{
      added:{
        geometries:(diff.resources?.geometries?.added || []).length,
        materials:(diff.resources?.materials?.added || []).length,
        textures:(diff.resources?.textures?.added || []).length
      }
    }
  };
}

export function registerCodeSkills(add, authoring) {
  if (!authoring || typeof authoring.run !== 'function' || typeof authoring.export !== 'function' || typeof authoring.restore !== 'function') {
    throw new TypeError('registerCodeSkills requires a World authoring context');
  }
  add('runAuthoringCode', {
    ...meta('用纯 Three.js 代码在创作层（draft layer）构建或修改世界内容。沙箱只注入 THREE、scene、clear、onFrame、modelRef。执行前静态拒绝危险 API；执行失败会自动恢复到执行前的创作文档并把错误原样返回，修正代码后可重新提交。代码产出只是草稿：正式世界实体必须再经 prepareAuthoringAsset / promoteAuthoringNode 晋升并验证。',
      ['world.write'], ['code'],
      { code:string, label:string }),
    mutates:true, manualMutation:true, batchable:false
  }, async (a) => {
    const validation = validateAuthoringCode(a.code);
    if (!validation.ok) return { status:'authoring-code-rejected', reason:validation.code, message:validation.message };
    const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : 'Authoring code';
    const baseline = authoring.export();
    let value;
    try {
      value = await authoring.run(a.code);
    } catch (error) {
      authoring.restore(baseline);
      return {
        status:'authoring-code-failed',
        reason:'AUTHORING_CODE_EXECUTION_ERROR',
        message:String(error?.message || error),
        instruction:'The draft was restored to its previous revision. Fix the code and submit it again.'
      };
    }
    const diff = diffAuthoringDocuments(baseline, authoring.export());
    if (diff.empty) return { status:'authoring-code-empty', reason:'AUTHORING_CODE_NO_CHANGE' };
    const revision = authoring.commit({ label, source:'agent-code' });
    return {
      status:'authoring-code-applied',
      label,
      revision,
      diff:summarizeAuthoringDiff(diff),
      ...(value !== undefined && ['string','number','boolean'].includes(typeof value) ? { value } : {})
    };
  });
}
