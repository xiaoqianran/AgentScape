const GENERATED_BOOTSTRAP = Object.freeze({ agent:[0,0,0] });

const generatedSource = (environment) => {
  const artifacts = environment?.generated?.artifacts;
  if (artifacts?.['world-manifest']) return `artifact:${artifacts['world-manifest']}`;
  const manifestUrl = environment?.generated?.manifest?.url;
  if (manifestUrl) return `manifest:${manifestUrl}`;
  const meshUrl = environment?.generated?.mesh?.url;
  if (meshUrl) return `mesh:${meshUrl}`;
  return null;
};

export function resolveStudioWorldIdentity(environment, {
  builtins = [],
  fallback = null
} = {}) {
  const id = environment?.id || fallback?.id || 'environment';
  const isGenerated = Boolean(environment?.generated);
  if (!isGenerated) {
    const builtin = builtins.find((item) => item.id === id) || (fallback?.id === id ? fallback : null);
    if (builtin) {
      return {
        id,
        title:builtin.title || id,
        number:builtin.number || 'WORLD',
        headline:builtin.headline || builtin.title || id,
        description:builtin.description || '',
        facts:[...(builtin.facts || [])],
        bootstrap:structuredClone(builtin.bootstrap || {}),
        worldFirst:Boolean(builtin.worldFirst),
        generated:false,
        persistenceSource:null
      };
    }
  }

  return {
    id,
    title:environment?.title || environment?.label || id,
    number:'GENERATED',
    headline:'Generated World',
    description:'由已验证的 World Artifact 驱动当前 Runtime。',
    facts:['GENERATED','RUNTIME'],
    bootstrap:structuredClone(GENERATED_BOOTSTRAP),
    worldFirst:false,
    generated:true,
    persistenceSource:generatedSource(environment)
  };
}

export function studioSceneStoreKey(identity) {
  if (identity?.generated) {
    const source = identity.persistenceSource || `environment:${identity.id || 'generated-world'}`;
    return `agentscape.scene.autosave.generated.${encodeURIComponent(source)}`;
  }
  return `agentscape.scene.autosave.${identity?.id || 'environment'}`;
}
