import { assetAdmission } from '../../../asset/admission.js';
import { meta, string } from '../skillPrimitives.js';

const syncLiveVerification = (runtime, assetId, manifest) => {
  for (const record of runtime.store?.values?.() || []) {
    if (record.assetId !== assetId) continue;
    record.manifest.verification = structuredClone(manifest.verification || {});
    if (manifest.compiler?.quality && record.manifest.compiler) record.manifest.compiler.quality = structuredClone(manifest.compiler.quality);
    if (record.object?.userData?.manifest) {
      record.object.userData.manifest.verification = structuredClone(record.manifest.verification);
      if (record.manifest.compiler?.quality && record.object.userData.manifest.compiler) record.object.userData.manifest.compiler.quality = structuredClone(record.manifest.compiler.quality);
    }
  }
};

export function registerAssetSkills(add,runtime) {
  add('compileAsset', {
    ...meta('把 GLB 编译为可运行的 Agent 资产。', ['asset.write'], [], { url:string, sourceName:string, assetId:string, label:string, partProposal:{type:'object'}, partSegmentation:{type:'object'} }),
    validate: (input) => input?.url || input?.bytes ? { ok: true } : { ok: false, message: 'url or bytes required' }
  }, async (input) => {
    const compiler = await runtime.generation?.getAssetCompiler?.();
    if (!compiler) throw Object.assign(new Error('Asset Compiler is not configured'), { code:'ASSET_COMPILER_UNAVAILABLE' });
    const result = await compiler.compile(input);
    runtime.assets.registerManifest(result.manifest);
    runtime.events.emit('asset.compiled', { assetId: result.manifest.id, report: result });
    return result;
  });
  add('verifyAssetArticulation', { ...meta('在隔离的已配置 physics backend 中执行 Part/Joint 运动轨迹验证（目标、碰撞、停滞、回程），并把结果写回 Manifest；backend 缺少所需 capability 时验证应失败关闭。', ['asset.write', 'physics.read'], ['assetId'], { assetId: string }), mutates: false }, async (a) => {
    const report = await runtime.articulationVerifier.verify(a.assetId);
    const manifest = structuredClone(runtime.assets.getManifest(a.assetId));
    manifest.verification = { ...(manifest.verification || {}), articulation: report };
    const quality = manifest.compiler?.quality;
    if (quality) {
      quality.advisory = (quality.advisory || []).filter((item) => item.code !== 'ARTICULATION_UNVERIFIED');
      if (!report.ok) quality.advisory.push({ code: 'ARTICULATION_VERIFICATION_FAILED', message: '可执行 Part/Joint 未通过运行时运动轨迹验证。' });
      quality.status = quality.hard?.length ? 'rejected' : quality.advisory.length ? 'provisional' : 'ready';
    }
    runtime.assets.registerManifest(manifest, { replace: true });
    syncLiveVerification(runtime, a.assetId, manifest);
    const admission=assetAdmission(manifest);
    runtime.events.emit('asset.verified', { assetId: a.assetId, articulation: report, admission:admission.status });
    return { ...report, readiness: admission.status, admission };
  });
  add('inspectCompiledAsset', meta('读取已编译资产的编译报告。', ['asset.read'], ['assetId'], { assetId: string }), (a) => runtime.assets.getManifest(a.assetId).compiler || null);
  add('listAssets', meta('列出资产库。', ['asset.read']), () => runtime.assetCatalog.list());
  add('searchAssets', meta('按名称、类型、标签或别名搜索可复用资产。', ['asset.read'], ['query'], { query: string, limit: { type: 'integer', minimum: 1, maximum: 20 } }), (a) => runtime.assetCatalog.search(a.query, { limit: a.limit ?? 8 }));
  add('generateAsset', meta('使用已配置的生成后端创建并注册缺失资产；调用前应先搜索。生成结果可能是 asset-provisional，不能因此假定世界已验证。', ['asset.write'], ['prompt'], { prompt: string }), async (a) => {
    if(typeof runtime.generation?.generateAsset!=='function'){
      return {status:'generator_not_configured',prompt:a.prompt,hint:'Generation runtime is not configured.'};
    }
    const result=await runtime.generation.generateAsset(a.prompt);
    const status=result.admission?.status || (result.status==='generator_not_configured'?'not-configured':'provisional');
    return { ...result, status:result.status==='generator_not_configured'?result.status:`asset-${status}` };
  });
}
