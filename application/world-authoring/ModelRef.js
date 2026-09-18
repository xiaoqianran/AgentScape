function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAssetRef(assetRef) {
  const assetId = String(assetRef?.assetId ?? '').trim();
  if (!assetId) throw new TypeError('World Authoring ModelRef requires a valid AssetRef');
  return { assetId };
}

export function normalizeAuthoringModelRef(reference) {
  const source = reference?.source || reference;

  if (source?.type === 'url') {
    const uri = String(source.uri || '').trim();
    if (!uri) throw new TypeError('World Authoring ModelRef URL requires uri');
    return { source:{ type:'url', uri } };
  }

  if (source?.type === 'asset') {
    return {
      source:{
        type:'asset',
        assetRef:normalizeAssetRef(source.assetRef)
      }
    };
  }

  if (reference?.assetRef) {
    return {
      source:{
        type:'asset',
        assetRef:normalizeAssetRef(reference.assetRef)
      }
    };
  }

  if (typeof reference?.uri === 'string' && reference.uri.trim()) {
    return { source:{ type:'url', uri:reference.uri.trim() } };
  }

  throw new TypeError('World Authoring ModelRef requires a url or AssetRef source');
}

export function markAuthoringModelRef(object, reference) {
  if (!object?.isObject3D) throw new TypeError('World Authoring ModelRef target must be an Object3D');
  object.userData ||= {};
  object.userData.authoringModelRef = normalizeAuthoringModelRef(reference);
  return object;
}

export function getAuthoringModelRef(object) {
  const reference = object?.userData?.authoringModelRef;
  return reference ? normalizeAuthoringModelRef(reference) : null;
}

export function cloneAuthoringModelRef(reference) {
  return clone(normalizeAuthoringModelRef(reference));
}
