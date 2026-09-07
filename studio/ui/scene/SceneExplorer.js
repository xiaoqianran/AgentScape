export const sceneExplorerMarkup = (environmentDefinition) => `
<aside class="scene-panel" aria-label="世界与场景">
  <div class="scene-panel-heading">
    <div>
      <span class="scene-eyebrow">WORLD</span>
      <strong id="scene-world-title">${environmentDefinition.title}</strong>
    </div>
    <span id="scene-object-count" class="scene-count">0</span>
  </div>
  <div class="scene-world-card">
    <span class="scene-world-dot"></span>
    <div>
      <strong id="scene-environment-id">${environmentDefinition.id}</strong>
      <small>Current environment</small>
    </div>
  </div>
  <div class="scene-section-heading">
    <span>Scene</span>
    <small>Objects</small>
  </div>
  <div id="scene-object-list" class="scene-object-list"></div>
</aside>`;

function objectLabel(record, id) {
  return record?.manifest?.label || record?.object?.name || record?.assetId || id;
}

export function collectSceneObjects(store, selectedId = null) {
  return store.list()
    .map(([id, record]) => ({
      id,
      assetId:record?.assetId || null,
      type:record?.manifest?.type || null,
      label:objectLabel(record, id),
      selected:id === selectedId
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export class SceneExplorer {
  constructor({ root, world, editor, environmentDefinition } = {}) {
    if (!root || !world?.store || !editor?.select) throw new TypeError('SceneExplorer requires root, world and editor');
    this.root = root;
    this.world = world;
    this.editor = editor;
    this.environmentDefinition = environmentDefinition;
    this.title = root.querySelector('#scene-world-title');
    this.environmentId = root.querySelector('#scene-environment-id');
    this.count = root.querySelector('#scene-object-count');
    this.list = root.querySelector('#scene-object-list');
    this.unsubscribers = [];
  }

  init() {
    for (const type of ['object.spawned','object.removed','object.duplicated','scene.restored','scene.cleared','environment.replaced']) {
      this.unsubscribers.push(this.world.events.on(type, () => this.render()));
    }
    this.unsubscribers.push(this.world.events.on('editor.selection', () => this.renderObjects()));
    this.render();
    return this;
  }

  destroy() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  render() {
    const environment = this.world.environment;
    this.title.textContent = environment?.title || environment?.label || this.environmentDefinition?.title || environment?.id || 'World';
    this.environmentId.textContent = environment?.id || this.environmentDefinition?.id || 'environment';
    this.renderObjects();
  }

  renderObjects() {
    const records = collectSceneObjects(this.world.store, this.editor.selectedId);
    this.count.textContent = String(records.length);
    this.list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'scene-empty';
      empty.textContent = 'No runtime objects';
      this.list.append(empty);
      return;
    }
    for (const record of records) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-object-row';
      button.dataset.objectId = record.id;
      button.classList.toggle('active', record.selected);

      const glyph = document.createElement('span');
      glyph.className = 'scene-object-glyph';
      glyph.textContent = record.assetId === 'agent' || record.type === 'agent' ? 'A' : '◆';

      const copy = document.createElement('span');
      copy.className = 'scene-object-copy';
      const strong = document.createElement('strong');
      strong.textContent = record.label;
      const small = document.createElement('small');
      small.textContent = record.id;
      copy.append(strong, small);
      button.append(glyph, copy);
      button.addEventListener('click', () => this.editor.select(record.id));
      this.list.append(button);
    }
  }
}
