export const DEFAULT_PROFILES = {
  viewer: ["generation.read", 'world.read', 'asset.read', 'spatial.read', 'physics.read'],
  builder: ["generation.read", "generation.submit", "generation.cancel", "artifact.import", 'world.read', 'world.write', 'asset.read', 'asset.write', 'spatial.read', 'physics.read'],
  admin: ['*']
};

export class PolicyEngine {
  constructor({ profiles = DEFAULT_PROFILES } = {}) {
    this.profiles = new Map(Object.entries(profiles).map(([k, v]) => [k, new Set(v)]));
  }

  permissionsFor(profile = 'builder') {
    return this.profiles.get(profile) || new Set();
  }

  evaluate({ profile = 'builder', required = [] } = {}) {
    const granted = this.permissionsFor(profile);
    const missing = required.filter((permission) => !granted.has('*') && !granted.has(permission));
    return { allow: missing.length === 0, profile, missing };
  }
}
