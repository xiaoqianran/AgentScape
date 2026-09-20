import { assetAdmission } from '../../modules/asset/model/admission.js';
import { physicsManifestForUniformScale, uniformScaleValue } from '../../modules/world/runtime/ObjectTransform.js';
import { capturePromotionSource, promotionError } from './AuthoringPromotionSource.js';

const clone = value => structuredClone(value);
const uid = prefix => `${prefix}_${globalThis.crypto.randomUUID()}`;
const USAGES = ['static', 'movable', 'interactive'];
const ACTIONS = ['pickup', 'open', 'close', 'read', 'write', 'toggle', 'turn_on', 'turn_off', 'push', 'pull'];
const portableState = state => {
  const result = clone(state);
  delete result.heldBy;
  delete result.navigation;
  return result;
};

export class AuthoringPromotionController {
  constructor({ authoring, world, produceAsset, verify = null, verifyBehavior = null }) {
    if (!authoring?.export || !world?.mutate || !world?.commands) throw new TypeError('Promotion requires Authoring and WorldRuntime');
    Object.assign(this, { authoring, world, produceAsset, verify, verifyBehavior });
    this.documentId = uid('authoring');
    this.entries = new Map();
    this.busy = false;
    this.stops = ['object.removed', 'scene.restored', 'environment.replaced', 'history.changed'].map(event =>
      world.events.on(event, () => this.reconcile()));
  }

  exportState() {
    // Store only our instances, and keep their latest runtime pose/state for reopening.
    const entries = [...this.entries.values()].map(entry => {
      const saved = clone(entry);
      const record = this.linkedRecord(entry);
      if (record) saved.instance = {
        position:record.object.position.toArray(), quaternion:record.object.quaternion.toArray(),
        scale:record.physicsScale || 1,
        // Held ownership and running navigation cannot be transferred into a partial world file.
        initialState:portableState(record.state)
      };
      return saved;
    });
    return { version:1, documentId:this.documentId, entries };
  }

  validateState(state) {
    if (state == null) return;
    if (state.version !== 1 || typeof state.documentId !== 'string' || !Array.isArray(state.entries)) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '晋升记录格式无效');
    const nodes = new Set(), entities = new Set();
    for (const entry of state.entries) {
      if (!entry.nodeId || nodes.has(entry.nodeId) || !USAGES.includes(entry.usage) || !entry.assetId || !entry.sourceHash || !entry.contentHash) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '晋升记录缺少身份或存在重复节点');
      nodes.add(entry.nodeId);
      if (entry.entityId) {
        if (entities.has(entry.entityId) || !entry.linkId || !entry.instance) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '晋升实体记录无效');
        entities.add(entry.entityId);
        const transform = entry.instance;
        const finite = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
        if (!finite(transform.position, 3) || !finite(transform.quaternion, 4) || Math.hypot(...transform.quaternion) < 1e-6) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '晋升实体变换无效');
        uniformScaleValue(transform.scale);
        const link = transform.initialState?.authoringPromotion;
        if (link?.documentId !== state.documentId || link?.nodeId !== entry.nodeId || link?.linkId !== entry.linkId) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '晋升实体来源关联无效');
        if ('heldBy' in transform.initialState || 'navigation' in transform.initialState) throw promotionError('AUTHORING_PROMOTION_STATE_INVALID', '创作存档不能恢复持有关系或运行中的导航');
      }
    }
  }

  loadState(state = null) {
    if (this.busy) throw promotionError('AUTHORING_PROMOTION_BUSY', '晋升操作尚未完成');
    this.validateState(state);
    this.documentId = state?.documentId || uid('authoring');
    this.entries = new Map((state?.entries || []).map(entry => [entry.nodeId, clone(entry)]));
    this.reconcile();
  }

  linkedRecord(entry) {
    if (!entry?.entityId || entry.worldId !== (this.world.environment?.id || null) || !this.world.store.has(entry.entityId)) return null;
    const record = this.world.store.get(entry.entityId);
    const link = record.state?.authoringPromotion;
    return record.assetId === entry.assetId && link?.documentId === this.documentId && link?.linkId === entry.linkId ? record : null;
  }

  reconcile() {
    // World undo/redo can restore an older installed revision. Adopt its provenance,
    // not the latest editor record, without issuing another World command.
    for (const [, record] of this.world.store.list()) {
      const link = record.state?.authoringPromotion;
      const entry = link && this.entries.get(link.nodeId);
      if (entry?.entityId === record.id && link.documentId === this.documentId
        && entry.worldId === (this.world.environment?.id || null) && link.contentHash) {
        if (entry.linkId !== link.linkId) entry.verification = null;
        Object.assign(entry, { assetId:record.assetId, linkId:link.linkId, sourceHash:link.sourceHash,
          contentHash:link.contentHash, usage:link.usage, revisionId:link.revisionId });
      }
    }
    this.authoring.setPromotedNodes([...this.entries.values()].filter(entry => this.linkedRecord(entry)).map(entry => entry.nodeId));
  }

  list() {
    this.reconcile();
    const document = this.authoring.export();
    const nodes = [];
    const visit = (node, depth = 0) => {
      if (node.id !== document.root.id) {
        const entry = this.entries.get(node.id);
        let source = null, reason = null;
        try { source = capturePromotionSource(this.authoring, node.id); } catch (error) { reason = error.message; }
        const linked = this.linkedRecord(entry);
        let status = entry ? (entry.entityId ? (linked ? 'promoted' : 'missing') : 'prepared') : 'draft';
        if (entry && source && source.sourceHash !== entry.sourceHash) status = linked ? 'outdated' : 'changed';
        const admission = entry && this.world.assetModule.hasAsset(entry.assetId) ? assetAdmission(this.world.assetModule.getManifest(entry.assetId)) : null;
        if (status === 'promoted' && admission?.status !== 'ready') status = 'editing';
        nodes.push({ nodeId:node.id, name:node.name || node.id, depth, status, reason, usage:entry?.usage || 'static',
          assetId:entry?.assetId || null, entityId:entry?.entityId || null,
          admission,
          verification:entry?.verification || null });
      }
      for (const child of node.children || []) visit(child, depth + 1);
    };
    visit(document.root, -1);
    return nodes;
  }

  async runExclusive(operation) {
    if (this.busy || this.fileBusy) throw promotionError('AUTHORING_PROMOTION_BUSY', '创作存档或晋升操作尚未完成');
    this.busy = true;
    try { return await operation(); }
    finally { this.busy = false; this.reconcile(); this.world.events.emit('authoring.promotion.changed', {}); }
  }

  assertSource(source, worldId) {
    if (worldId !== (this.world.environment?.id || null)
      || capturePromotionSource(this.authoring, source.nodeId).sourceHash !== source.sourceHash) {
      throw promotionError('AUTHORING_PROMOTION_STALE', '创作对象或当前世界已改变，请重新准备');
    }
  }

  checkSelection(source) {
    for (const entry of this.entries.values()) {
      if (entry.nodeId === source.nodeId || !entry.entityId) continue;
      const other = this.authoring.get(entry.nodeId);
      if (!other) continue;
      let node = source.object;
      while (node) {
        if (node === other) throw promotionError('AUTHORING_PROMOTION_OVERLAP', '该对象属于已晋升分组，请更新该分组');
        node = node.parent;
      }
      if (source.ids.includes(entry.nodeId)) throw promotionError('AUTHORING_PROMOTION_OVERLAP', '该分组包含已晋升对象，请先解除已有晋升关联');
    }
  }

  async prepare(nodeId, { usage = 'static' } = {}) {
    return this.runExclusive(async () => {
      const source = capturePromotionSource(this.authoring, nodeId);
      const worldId = this.world.environment?.id || null;
      const prepared = await this.prepareSource(source, usage);
      this.assertSource(source, worldId);
      // Preparing a changed source must not overwrite the currently installed version.
      const previous = this.entries.get(nodeId);
      if (previous?.entityId) this.entries.set(nodeId, { ...previous, pending:prepared });
      else this.entries.set(nodeId, prepared);
      return { status:'authoring-prepared', ...clone(prepared) };
    });
  }

  async prepareSource(source, usage) {
    if (!USAGES.includes(usage)) throw promotionError('AUTHORING_USAGE_INVALID', '未知的对象用途');
    this.checkSelection(source);
    const existing = this.entries.get(source.nodeId);
    const cached = existing?.pending || existing;
    let assetId;
    if (source.reference?.source?.type === 'asset') assetId = source.reference.source.assetRef.assetId;
    else if (cached?.contentHash === source.contentHash && cached.usage === usage) assetId = cached.assetId;
    else {
      if (!this.produceAsset) throw promotionError('AUTHORING_PRODUCTION_UNAVAILABLE', '创作资产生产尚未配置');
      const produced = await this.produceAsset(source, { usage });
      if (produced.status === 'asset-rejected') throw promotionError('AUTHORING_ASSET_REJECTED', `资产被拒绝：${produced.admission?.reasons?.join(', ') || '编译失败'}`);
      assetId = produced.assetId;
    }
    if (!this.world.assetModule.hasAsset(assetId)) throw promotionError('AUTHORING_ASSET_MISSING', '正式资产不存在，请重新准备');
    const manifest = this.world.assetModule.getManifest(assetId);
    const admission = assetAdmission(manifest);
    if (admission.status === 'rejected') throw promotionError('AUTHORING_ASSET_REJECTED', admission.reasons.join(', '));
    if (usage === 'static' && manifest.physics?.body !== 'fixed') throw promotionError('AUTHORING_USAGE_MISMATCH', '该资产不是静态物件，请选择匹配的用途');
    if (usage === 'movable' && (manifest.physics?.body !== 'dynamic' || !manifest.actions?.includes('pickup'))) throw promotionError('AUTHORING_USAGE_MISMATCH', '该资产没有动态刚体和拾取能力');
    if (usage === 'interactive' && !manifest.actions?.some(action => ACTIONS.includes(action))) throw promotionError('AUTHORING_USAGE_MISMATCH', '该资产尚未具备可执行交互，请先完善资产能力');
    physicsManifestForUniformScale(manifest, source.transform.scale);
    return { nodeId:source.nodeId, name:source.name, assetId, usage, sourceHash:source.sourceHash,
      contentHash:source.contentHash, revisionId:source.revisionId, transform:source.transform, admission };
  }

  async promote(nodeId, { usage = null, allowProvisional = false, update = false } = {}) {
    return this.runExclusive(async () => {
      const source = capturePromotionSource(this.authoring, nodeId);
      const worldId = this.world.environment?.id || null;
      const previous = this.entries.get(nodeId);
      const linked = this.linkedRecord(previous);
      if (linked && source.sourceHash === previous.sourceHash && (!usage || usage === previous.usage)) return {
        status:assetAdmission(this.world.assetModule.getManifest(previous.assetId)).status === 'ready' ? 'authoring-promoted' : 'authoring-provisional', reused:true, ...clone(previous)
      };
      if (previous?.entityId && !update) throw promotionError('AUTHORING_UPDATE_REQUIRED', '该对象已有晋升记录，请使用更新或恢复操作');
      if (previous?.entityId && previous.worldId !== worldId) throw promotionError('AUTHORING_WORLD_MISMATCH', '请在原目标世界中更新此对象');
      const prepared = await this.prepareSource(source, usage || previous?.usage || 'static');
      this.assertSource(source, worldId);
      if (prepared.admission.status !== 'ready' && !allowProvisional) throw promotionError('AUTHORING_ASSET_PROVISIONAL', `资产仅可用于编辑态：${prepared.admission.reasons.join(', ')}`);
      const entry = { ...prepared, worldId, entityId:previous?.entityId || uid('entity'),
        linkId:uid('promotion'), instance:{ ...prepared.transform } };
      entry.instance.initialState = { authoringPromotion:{ documentId:this.documentId, nodeId, linkId:entry.linkId,
        sourceHash:source.sourceHash, contentHash:source.contentHash, usage:entry.usage, revisionId:source.revisionId } };
      if (linked?.assetId === entry.assetId) entry.instance.initialState = {
        ...portableState(linked.state), ...entry.instance.initialState
      };
      const result = await this.install(entry, { previous, source, allowProvisional });
      this.entries.set(nodeId, entry);
      return result;
    });
  }

  async install(entry, { previous = null, source = null, allowProvisional = false } = {}) {
    const manifest = this.world.assetModule.getManifest(entry.assetId);
    if (!manifest) throw promotionError('AUTHORING_ASSET_MISSING', '恢复所需的资产不存在');
    const admission = assetAdmission(manifest);
    if (admission.status === 'rejected' || (admission.status !== 'ready' && !allowProvisional)) throw promotionError('AUTHORING_ASSET_NOT_READY', '资产当前未通过正式准入');
    const old = previous && this.linkedRecord(previous);
    if (this.world.store.has(entry.entityId) && !old) throw promotionError('AUTHORING_ENTITY_CONFLICT', '目标实体 ID 已被其他对象占用');
    if (old?.state?.heldBy) throw promotionError('AUTHORING_ENTITY_HELD', '请先放下正在持有的对象');
    return this.world.mutate('authoring:promote', async () => {
      if (entry.worldId !== (this.world.environment?.id || null)) throw promotionError('AUTHORING_WORLD_MISMATCH', '晋升的目标世界不匹配');
      if (source) this.assertSource(source, entry.worldId);
      const scaled = physicsManifestForUniformScale(manifest, entry.instance.scale);
      const pose = this.world.physics.checkManifestPose(scaled, entry.instance.position, {
        quaternion:entry.instance.quaternion, excludeIds:old ? [entry.entityId] : []
      });
      if (pose.checked && !pose.clear) throw promotionError('AUTHORING_PLACEMENT_BLOCKED', `放置位置发生碰撞：${pose.blockedBy?.join(', ')}`);
      if (!pose.checked && !allowProvisional) throw promotionError('AUTHORING_PLACEMENT_UNVERIFIED', '当前物理后端无法验证该位置');
      if (old) this.world.commands.remove(entry.entityId);
      const spawned = await this.world.commands.spawn(entry.assetId, { id:entry.entityId, ...entry.instance });
      if (spawned?.status === 'asset-rejected') throw promotionError('AUTHORING_ASSET_REJECTED', '资产在实例化时被拒绝');
      if (!this.world.store.has(entry.entityId)) throw promotionError('AUTHORING_SPAWN_FAILED', '世界没有创建目标实体');
      const physicsPosition = this.world.physics.getPosition(entry.entityId);
      if (!physicsPosition) throw promotionError('AUTHORING_PHYSICS_FAILED', '世界实体没有物理刚体');
      const navigation = this.world.navigation?.ensureCurrent
        ? await this.world.navigation.ensureCurrent() : { success:false, code:'NAVIGATION_UNAVAILABLE' };
      entry.verification = { physics:{ registered:true, placement:clone(pose) },
        navigation:clone(navigation), interaction:{ status:'not-exercised', actions:manifest.actions.filter(action => ACTIONS.includes(action)) },
        admission:clone(admission), checkedAt:new Date().toISOString() };
      if (this.verify) {
        const verification = await this.verify(entry, this.world);
        if (verification?.ok === false) throw promotionError('AUTHORING_VERIFICATION_FAILED', verification.reason || '世界行为验证失败');
        entry.verification.behavior = clone(verification);
      }
      if (source) this.assertSource(source, entry.worldId);
      return { status:admission.status === 'ready' ? 'authoring-promoted' : 'authoring-provisional', ...clone(entry) };
    }, { source:'authoring', nodeId:entry.nodeId, documentId:this.documentId });
  }

  async restore({ allowProvisional = false } = {}) {
    return this.runExclusive(async () => {
      const results = [];
      for (const entry of this.entries.values()) {
        if (!entry.entityId || this.linkedRecord(entry)) continue;
        try {
          const result = await this.install(entry, { allowProvisional });
          results.push({ nodeId:entry.nodeId, ...result });
        } catch (error) { results.push({ nodeId:entry.nodeId, status:'authoring-restore-failed', code:error.code, reason:error.message }); }
      }
      return { status:results.some(result => result.status === 'authoring-restore-failed') ? 'authoring-restore-failed' : 'authoring-restored', results };
    });
  }

  async detach(nodeId) {
    return this.runExclusive(async () => {
      // Detaching leaves the formal entity intact; it explicitly makes the draft independent again.
      const entry = this.entries.get(nodeId);
      this.entries.delete(nodeId);
      return { status:'authoring-detached', nodeId, entityId:entry?.entityId || null };
    });
  }

  async verifyEntity(nodeId, { exerciseInteraction = false } = {}) {
    return this.runExclusive(async () => {
      const entry = this.entries.get(nodeId);
      const record = this.linkedRecord(entry);
      if (!record) throw promotionError('AUTHORING_ENTITY_MISSING', '请先恢复或晋升该对象');
      const manifest = this.world.assetModule.getManifest(entry.assetId);
      const actions = manifest.actions.filter(action => ACTIONS.includes(action));
      let interaction = { status:actions.length ? 'not-exercised' : 'not-applicable', actions };
      if (exerciseInteraction && actions.length) {
        if (!this.verifyBehavior) throw promotionError('AUTHORING_VERIFIER_UNAVAILABLE', '当前宿主没有配置行为验证器');
        try { interaction = { ...interaction, ...await this.verifyBehavior(entry, this.world) }; }
        catch (error) { interaction = { ...interaction, status:'failed', reason:error.code || error.message }; }
      }
      if (!this.linkedRecord(entry)) throw promotionError('AUTHORING_VERIFICATION_STALE', '验证过程中目标实体发生变化');
      const pose = this.world.physics.checkManifestPose(physicsManifestForUniformScale(manifest, record.physicsScale || 1), record.object.position.toArray(), {
        quaternion:record.object.quaternion.toArray(), excludeIds:[entry.entityId]
      });
      const navigation = await this.world.navigation?.ensureCurrent?.() || { success:false, code:'NAVIGATION_UNAVAILABLE' };
      entry.verification = { physics:{ registered:Boolean(this.world.physics.getPosition(entry.entityId)), placement:pose },
        navigation:clone(navigation), interaction:clone(interaction), admission:assetAdmission(manifest), checkedAt:new Date().toISOString() };
      const verified = pose.checked && pose.clear && navigation.success && ['verified', 'not-applicable'].includes(interaction.status);
      return { status:verified ? 'authoring-verified' : 'authoring-unverified', nodeId, entityId:entry.entityId, verification:clone(entry.verification) };
    });
  }

  dispose() { for (const stop of this.stops) stop(); this.authoring.setPromotedNodes([]); }
}
