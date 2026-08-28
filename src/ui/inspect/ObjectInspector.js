export const objectInspectorMarkup = () => `
  <section class="inspector" aria-label="检查">
    <header class="screen-heading">
      <div class="eyebrow">检查</div>
      <h1 id="inspect-heading">请选择对象</h1>
      <p id="inspect-subheading">点击世界中的对象，查看它的状态、关系和可用操作。</p>
    </header>

    <div id="empty-selection" class="empty-state">
      <strong>尚未选择对象</strong>
      <span>对象仍在视口中选择，这里只显示当前需要的上下文。</span>
    </div>

    <div id="selection" class="selection hidden">
      <div class="object-title">
        <div>
          <h2 id="object-id"></h2>
          <span id="object-type"></span>
        </div>
      </div>

      <section class="inspect-section">
        <h3>变换</h3>
        <dl class="properties">
          <div><dt>位置</dt><dd id="position"></dd></div>
          <div><dt>旋转</dt><dd id="rotation"></dd></div>
        </dl>
      </section>

      <section class="inspect-section">
        <h3>关系</h3>
        <div id="relation-info" class="relation-info"></div>
        <div id="spatial-info" class="spatial-info"></div>
      </section>

      <section class="inspect-section">
        <h3>操作</h3>
        <div id="actions" class="action-list"></div>
      </section>

      <details class="disclosure">
        <summary>资产详情</summary>
        <dl class="properties detail-properties">
          <div><dt>资产</dt><dd id="asset-id"></dd></div>
          <div><dt>实例</dt><dd id="instance-id"></dd></div>
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
      this.heading.textContent = '请选择对象';
      this.subheading.textContent = '点击世界中的对象，查看它的状态、关系和可用操作。';
      return;
    }

    const info = this.world.getObjectInfo(id);
    this.empty.classList.add('hidden');
    this.selection.classList.remove('hidden');
    this.heading.textContent = info.id;
    this.subheading.textContent = `${info.type} 实例`;
    this.objectId.textContent = info.id;
    this.objectType.textContent = info.type;
    this.assetId.textContent = info.asset;
    this.instanceId.textContent = info.id;
    this.position.textContent = info.position.join(', ');
    this.rotation.textContent = `${info.rotation.join(', ')}°`;

    const bounds = this.world.spatial.getBounds(id);
    const nearby = this.world.spatial.findNearby(id, 2);
    this.spatial.textContent = `尺寸 ${bounds.size.join(' × ')} · 附近 ${nearby.length} 个对象`;

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
      empty.textContent = '暂无语义关系。';
      this.relations.append(empty);
    }

    this.actions.replaceChildren();
    const labels = { open: '打开', close: '关闭', pickup: '拿起', drop: '放下' };
    for (const action of info.actions) {
      if (!Object.hasOwn(labels, action)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = labels[action];
      button.addEventListener('click', async () => {
        try {
          await this.tools.call(action === 'drop' ? 'drop' : action, { id });
        } catch (error) {
          this.log(`错误：${error.message}`, 'error');
        }
      });
      this.actions.append(button);
    }
    if (!this.actions.children.length) {
      const empty = document.createElement('span');
      empty.className = 'muted-copy';
      empty.textContent = '暂无可直接执行的操作。';
      this.actions.append(empty);
    }
  }
}
