# Authoring → Asset → World Entity

Authoring v1 remains a visual document format. Promotion is an explicit application operation implemented by `application/world-authoring/AuthoringPromotionController.js`, composed by `createSession()`. Saving, loading, patching and undoing an AuthoringDocument do not issue World commands.

## Studio workflow

Open **场景 → 将创作对象加入世界**, select an authored node or Group, and choose static, movable/pickup, or an existing interactive asset.

1. **准备正式资产** checks an existing AssetRef or exports visual content into a verified GLB Artifact and runs AssetModule production. It leaves the draft intact.
2. **晋升为世界实体** checks usage, admission, scale and collision placement, then creates a World Entity through WorldCommands inside a World history transaction.
3. **将原稿更新到世界** explicitly replaces the installed version, preserving its entity ID. If the asset is unchanged, portable instance state is retained. A failed replacement restores the previous World snapshot.
4. **检查物理与导航** checks the installed physics pose and current navigation build/synchronization. **执行 Agent 交互验证** additionally uses Studio's existing pickup/carry/place verifier or embodied articulation action. These actions need the corresponding Agent, support surface or executable part in the World. Unsupported behavior is reported, never treated as verified.
5. Save the authoring world. Reopening restores the draft and associates matching live entities. **恢复存档关联实体** explicitly reinstalls missing instances in their original target World. It never overwrites an unrelated entity or creates a cross-world copy.

For provisional assets, the explicit **允许未就绪资产进入编辑态** checkbox is required. Editing state, formal admission and behavior verification are separate results. A successful behavior test never upgrades Asset admission.

## Supported source content

- AssetRef ModelRef: reuse the registered asset; the Authoring subtree is never inserted directly into the ObjectStore.
- Mesh and Group: export the selected subtree, including geometry, supported materials, textures and child transforms.
- InstancedMesh: materialize individual instances into GLB, preserving transforms and instance colors.
- Resolved URL ModelRef: export the loaded geometry through the same verified Artifact production boundary.

Authored GLBs preserve their origin during compilation. Explicit static/movable intent configures body type and actions, but does not supply verification evidence or bypass compiler quality gates. The compiler's coarse collider and low-confidence findings remain provisional.

Lights, cameras, embedded skinned models and animation are rejected for visual-to-asset export. Keep lighting in Authoring or use an already registered asset for complex runtime models. Unresolved models, invisible selected nodes/ancestors, sheared transforms, negative/nonuniform/out-of-range instance scale, and unsupported articulated scale fail explicitly. Nested promotions cannot overlap.

## Persistence and ownership

AuthoringWorldStore records may contain a separate `promotions` envelope:

```js
{
  version: 1,
  documentId,
  entries: [{
    nodeId, sourceHash, contentHash, revisionId,
    assetId, usage, worldId, entityId, linkId,
    instance: { position, quaternion, scale, initialState },
    verification
  }]
}
```

The stable document/node/revision association is copied to the World instance's `state.authoringPromotion`, so ordinary scene serialization and World history retain it. The AssetRegistry remains asset identity truth; the World ObjectStore remains instance truth. Existing authoring files without an envelope continue to load.

Saving captures the latest linked instance pose and portable state. Held ownership and running navigation are not transferred into partial authoring files. Compiled GLBs and manifests use existing Asset persistence; the envelope does not duplicate them. Missing asset bytes or failed asset hydration remain explicit errors.

The source document keeps its authored visibility. A presentation override suppresses a draft only while its matching World instance exists. Removing or undoing the entity shows the draft again; World redo re-establishes the association. Authoring undo/redo does not mutate the Entity. Editing a promoted draft marks it out of date until an explicit update. Preparing an update retains the previously installed version and holds the new preparation separately.

Save As creates another snapshot of the same logical document and its associations. To create an independent copy, detach the relevant associations before promoting again. **解除关联，保留世界实体** preserves the formal object and makes the draft independent and visible; move the draft before promoting it again if the old entity occupies that location.

## Application / Agent API

`createSession()` returns `{ world, generation, authoring, promotion }`. Hosts dispose promotion before disposing Authoring and World.

```js
await promotion.prepare(nodeId, { usage: 'static' });
await promotion.promote(nodeId, { usage: 'static' });
await promotion.promote(nodeId, { update: true });
await promotion.restore({ allowProvisional: false });
await promotion.verifyEntity(nodeId, { exerciseInteraction: true });
```

Studio invokes these registered skills through AgentTools, retaining authorization, trace and World history:

- `listAuthoringNodes`
- `prepareAuthoringAsset`
- `promoteAuthoringNode`
- `updateAuthoringEntity`
- `restoreAuthoringEntities`
- `verifyAuthoringEntity`
- `detachAuthoringEntity`

Promotion checks for source/world changes across asynchronous production and verification. Duplicate requests are serialized, repeat promotion of an unchanged live version is idempotent, failed mutations roll back, and malformed persisted bindings are rejected before replacing the live draft. Restore reports a result for each missing entity, retaining successful independent restorations and reporting any failures.

## Validation

`tests/integration/authoring-promotion.test.js` exercises real Rapier, Recast, GLB export/compiler/loading, artifact integrity, placement, source edits, undo/redo, persistence, rollback, identity conflicts, provisional gating, Group/InstancedMesh/URL models and verification separation. The browser workflow additionally checks the Studio controls against IndexedDB-backed assets and authoring files.
