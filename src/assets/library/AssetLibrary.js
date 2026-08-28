import { AssetCatalog } from '../AssetCatalog.js';

export class AssetLibrary {
  constructor({ assetManager, catalog = null } = {}) {
    if (!assetManager) throw new TypeError('AssetLibrary requires assetManager');
    this.assetManager = assetManager;
    this.catalog = catalog || new AssetCatalog({ assetManager });
  }

  has(assetId) { return this.catalog.has(assetId); }
  get(assetId) { return this.catalog.get(assetId); }
  list() { return this.catalog.list(); }
  summary(manifest) { return this.catalog.summary(manifest); }
  search(query, options) { return this.catalog.search(query, options); }
  resolveExisting(query, options) { return this.catalog.resolveExisting(query, options); }
}
