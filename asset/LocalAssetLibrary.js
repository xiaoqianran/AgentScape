import { LocalAssetLibraryStore } from './storage/LocalAssetLibraryStore.js';

const clone=(value)=>value==null?value:structuredClone(value);

export class LocalAssetLibrary {
  constructor({assetManager,compiledStore,store=null,now=()=>new Date().toISOString()}={}) {
    if(!assetManager?.getManifest || !assetManager?.has) throw new TypeError('LocalAssetLibrary requires AssetManager');
    if(!compiledStore || (typeof compiledStore.has!=='function' && typeof compiledStore.get!=='function')) throw new TypeError('LocalAssetLibrary requires CompiledAssetStore');
    this.assetManager=assetManager;
    this.compiledStore=compiledStore;
    this.store=store || new LocalAssetLibraryStore();
    this.now=now;
    this.entries=new Map();
    this.hydrated=false;
  }

  async hydrate() {
    if(this.hydrated) return {restored:this.entries.size};
    const entries=await this.store.list();
    this.entries.clear();
    for(const entry of entries) if(entry?.assetId) this.entries.set(entry.assetId,clone(entry));
    this.hydrated=true;
    return {restored:this.entries.size};
  }

  async approve(assetId,metadata={}) {
    const manifest=this.assetManager.getManifest(assetId);
    if(manifest.source?.kind!=='compiled' || !manifest.source?.key) {
      const error=new Error(`Only compiled assets can enter the persistent local library: ${assetId}`);
      error.code='ASSET_LIBRARY_COMPILED_REQUIRED';
      throw error;
    }
    const bytesAvailable=typeof this.compiledStore.has==='function'
      ? await this.compiledStore.has(manifest.source.key)
      : Boolean(await this.compiledStore.get(manifest.source.key));
    if(!bytesAvailable) {
      const error=new Error(`Compiled GLB bytes are missing for asset: ${assetId}`);
      error.code='ASSET_LIBRARY_BYTES_MISSING';
      throw error;
    }
    const previous=await this.store.get(assetId);
    const entry={
      assetId,
      status:'approved',
      approvedAt:previous?.approvedAt || this.now(),
      updatedAt:this.now(),
      sourceKey:manifest.source.key,
      label:String(metadata.label || manifest.label || assetId),
      sourceImageArtifactId:metadata.sourceImageArtifactId || previous?.sourceImageArtifactId || null,
      notes:metadata.notes || previous?.notes || null
    };
    await this.store.put(entry);
    this.entries.set(assetId,clone(entry));
    this.hydrated=true;
    return clone(entry);
  }

  async get(assetId) {
    if(!this.hydrated) await this.hydrate();
    const entry=this.entries.get(assetId)||null;
    if(!entry || !this.assetManager.has(assetId)) return null;
    return clone(entry);
  }

  async isApproved(assetId) {
    return (await this.get(assetId))?.status==='approved';
  }

  async list() {
    if(!this.hydrated) await this.hydrate();
    return this.listSync();
  }

  listSync() {
    return [...this.entries.values()]
      .filter((entry)=>entry?.status==='approved' && this.assetManager.has(entry.assetId))
      .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))
      .map(clone);
  }

  async remove(assetId) {
    const removed=await this.store.delete(assetId);
    this.entries.delete(assetId);
    return removed;
  }
}
