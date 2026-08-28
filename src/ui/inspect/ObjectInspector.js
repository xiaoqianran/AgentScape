export const objectInspectorMarkup = () => `
  <section class="inspector" aria-label="Inspect">
    <header class="screen-heading">
      <div class="eyebrow">Inspect</div>
      <h1 id="inspect-heading">Select an object</h1>
      <p id="inspect-subheading">Click an object in the world to inspect its state, relations, and actions.</p>
    </header>

    <div id="empty-selection" class="empty-state">
      <strong>No object selected</strong>
      <span>Selection stays in the viewport. This panel only shows the context you need.</span>
    </div>

    <div id="selection" class="selection hidden">
      <div class="object-title">
        <div>
          <h2 id="object-id"></h2>
          <span id="object-type"></span>
        </div>
      </div>

      <section class="inspect-section">
        <h3>Transform</h3>
        <dl class="properties">
          <div><dt>Position</dt><dd id="position"></dd></div>
          <div><dt>Rotation</dt><dd id="rotation"></dd></div>
        </dl>
      </section>

      <section class="inspect-section">
        <h3>Relations</h3>
        <div id="relation-info" class="relation-info"></div>
        <div id="spatial-info" class="spatial-info"></div>
      </section>

      <section class="inspect-section">
        <h3>Actions</h3>
        <div id="actions" class="action-list"></div>
      </section>

      <details class="disclosure">
        <summary>Asset details</summary>
        <dl class="properties detail-properties">
          <div><dt>Asset</dt><dd id="asset-id"></dd></div>
          <div><dt>Instance</dt><dd id="instance-id"></dd></div>
        </dl>
      </details>
    </div>
  </section>`;

export class ObjectInspector {
  constructor({ root, world, tools, log = () => {} }) {
    this.root = root;
    this.world = world;
    this.tools = tools;
    this.log = log;
    const q = (selector) => root.querySelector(selector);
    this.empty = q('#empty-selection');
    this.selection = q('#selection');
    this.heading = q('#inspect-heading');
    this.subheading = q('#inspect-subheading');
    this.objectId = q('#object-id');
    this.objectType = q('#object-type');
    this.assetId = q('#asset-id');
    this.instanceId = q('#instance-id');
    this.position = q('#position');
    this.rotation = q('#rotation');
    this.spatial = q('#spatial-info');
    this.relations = q('#relation-info');
    this.actions = q('#actions');
    this.tab = root.querySelector('[data-panel-view="inspect"]');
  }

  render(id) {
    this.tab?.classList.toggle('has-selection', Boolean(id));
    if (!id) {
      this.empty.classList.remove('hidden');
      this.selection.classList.add('hidden');
      this.heading.textContent = 'Select an object';
      this.subheading.textContent = 'Click an object in the world to inspect its state, relations, and actions.';
      return;
    }

    const info = this.world.getObjectInfo(id);
    this.empty.classList.add('hidden');
    this.selection.classList.remove('hidden');
    this.heading.textContent = info.id;
    this.subheading.textContent = `${info.type} instance`;
    this.objectId.textContent = info.id;
    this.objectType.textContent = info.type;
    this.assetId.textContent = info.asset;
    this.instanceId.textContent = info.id;
    this.position.textContent = info.position.join(', ');
    this.rotation.textContent = `${info.rotation.join(', ')}°`;

    const bounds = this.world.spatial.getBounds(id);
    const nearby = this.world.spatial.findNearby(id, 2);
    this.spatial.textContent = `Size ${bounds.size.join(' × ')} · ${nearby.length} nearby`;

    this.world.sceneGraph.update();
    const relations = this.world.sceneGraph.describe(id);
    this.relations.replaceChildren();
    const visible = relations.outgoing.filter((relation) => ['ON', 'NEAR', 'INSIDE'].includes(relation.predicate)).slice(0, 8);
    for (const relation of visible) {
      const row = document.createElement('div');
      const predicate = document.createElement('strong');
      const target = document.createElement('span');
      predicate.textContent = relation.predicate;
      target.textContent = relation.object;
      row.append(predicate, target);
      this.relations.append(row);
    }
    if (!visible.length) {
      const empty = document.createElement('span');
      empty.className = 'muted-copy';
      empty.textContent = 'No semantic relations.';
      this.relations.append(empty);
    }

    this.actions.replaceChildren();
    const labels = { open: 'Open', close: 'Close', pickup: 'Pick up', drop: 'Drop' };
    for (const action of info.actions) {
      if (!Object.hasOwn(labels, action)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = labels[action];
      button.addEventListener('click', async () => {
        try {
          await this.tools.call(action === 'drop' ? 'drop' : action, { id });
        } catch (error) {
          this.log(`error: ${error.message}`, 'error');
        }
      });
      this.actions.append(button);
    }
    if (!this.actions.children.length) {
      const empty = document.createElement('span');
      empty.className = 'muted-copy';
      empty.textContent = 'No direct actions available.';
      this.actions.append(empty);
    }
  }
}
