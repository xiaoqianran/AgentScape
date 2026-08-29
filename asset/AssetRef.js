const clean = (value) => String(value ?? '').trim();

export function createAssetRef(assetId) {
  const id = clean(assetId);
  if (!id) throw new TypeError('AssetRef requires assetId');
  return { assetId: id };
}

export function assetIdFromRef(assetRef) {
  const id = clean(assetRef?.assetId);
  return id || null;
}
