import { ASSET_DRAG_MIME } from '../../editor/AssetPlacementController.js';

const byLabel = (a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id));

export const resourceLibraryMarkup = () => `
<section class="resource-console" aria-label="资源库">
  <header class="screen-heading">
    <div class="eyebrow">资源</div>
    <h1>Resource Library</h1>
    <p>Artifact 用于追踪来源；Asset 可直接拖入世界。</p>
  </header>
  <div class="resource-controls">
    <div class="resource-kind-tabs" role="tablist" aria-label="资源类型">
      <button type="button" data-resource-kind="assets" class="active" aria-selected="true">Assets</button>
      <button type="button" data-resource-kind="images" aria-selected="false">Images</button>
      <button type="button" data-resource-kind="worlds" aria-selected="false">Worlds</button>
    </div>
    <input id="resource-search" class="resource-search" type="search" placeholder="搜索当前资源…" aria-label="搜索资源" />
  </div>
  <div id="resource-list" class="resource-list"></div>
</section>`;

export function collectResourceLibrary({ assetCatalog, artifactRegistry, environments = [], currentEnvironmentId = null } = {}) {
  const assets = (assetCatalog?.list?.() || []).slice().sort(byLabel);
  const artifacts = artifactRegistry?.list?.() || [];
  const images = artifacts
    .filter((artifact) => String(artifact.mime || '').startsWith('image/'))
    .map((artifact) => ({
      id:artifact.id,
      label:artifact.displayName || artifact.id,
      mime:artifact.mime,
      format:artifact.format,
      bytes:artifact.bytes,
      integrity:artifact.integrity?.state || 'declared',
      provider:artifact.producer?.provider || null,
      jobId:artifact.producer?.jobId || null,
      descriptor:artifact
    }))
    .sort(byLabel);
  const generatedWorlds = artifacts
    .filter((artifact) => artifact.role === 'world-manifest')
    .map((artifact) => ({
      id:artifact.id,
      label:artifact.displayName || artifact.id,
      source:'generated',
      current:false,
      integrity:artifact.integrity?.state || 'declared',
      provider:artifact.producer?.provider || null,
      jobId:artifact.producer?.jobId || null,
      descriptor:artifact
    }))
    .sort(byLabel);
  const worlds = [
    ...environments.map((environment) => ({
      id:environment.id,
      label:environment.title || environment.id,
      description:environment.description || '',
      number:environment.number || '',
      source:'builtin',
      current:environment.id === currentEnvironmentId
    })),
    ...generatedWorlds
  ];
  return { assets, images, worlds };
}

function localArtifactEntry(world, artifact) {
  const location = artifact?.locations?.find((item) => item.kind === 'local-cache' && item.state === 'available' && item.access?.kind === 'cache-key');
  if (!location) return null;
  return world.generation?.artifacts?.byteStore?.get?.(location.access.key) || null;
}

function el(tag, className = '', content = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = String(content);
  return node;
}

function metaLine(...parts) {
  return parts.filter(Boolean).join(' · ');
}

export class ResourceLibrary {
  constructor({ root, world, environments = [], placement, openEnvironment = null, openGeneratedWorld = null, log = () => {} } = {}) {
    if (!root || !world?.assetCatalog || !world?.generation?.artifacts?.registry) throw new TypeError('ResourceLibrary requires Studio root and hydrated runtime resources');
    if (!placement?.beginDrag || !placement?.placeAtCenter) throw new TypeError('ResourceLibrary requires AssetPlacementController');
    this.root = root;
    this.world = world;
    this.environments = environments;
    this.placement = placement;
    this.openEnvironment = typeof openEnvironment === 'function' ? openEnvironment : null;
    this.openGeneratedWorld = typeof openGeneratedWorld === 'function' ? openGeneratedWorld : null;
    this.log = log;
    this.kind = 'assets';
    this.objectUrls = new Set();
    this.unsubscribers = [];
    this.bindElements();
  }

  bindElements() {
    this.list = this.root.querySelector('#resource-list');
    this.search = this.root.querySelector('#resource-search');
    this.kindButtons = [...this.root.querySelectorAll('[data-resource-kind]')];
    if (!this.list || !this.search || !this.kindButtons.length) throw new Error('ResourceLibrary markup is missing');
  }

  init() {
    for (const button of this.kindButtons) button.addEventListener('click', () => this.setKind(button.dataset.resourceKind));
    this.search.addEventListener('input', () => this.render());
    for (const type of ['generation.artifact.imported','assetProduction.registered','asset.compiled','asset.verified','environment.replaced']) {
      this.unsubscribers.push(this.world.events.on(type, () => this.render()));
    }
    this.render();
    return this;
  }

  setKind(kind) {
    if (!['assets','images','worlds'].includes(kind)) return;
    this.kind = kind;
    for (const button of this.kindButtons) {
      const active = button.dataset.resourceKind === kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    this.search.placeholder = kind === 'assets' ? '搜索 Asset…' : kind === 'images' ? '搜索 Image Artifact…' : '搜索 World…';
    this.render();
  }

  snapshot() {
    return collectResourceLibrary({
      assetCatalog:this.world.assetCatalog,
      artifactRegistry:this.world.generation.artifacts.registry,
      environments:this.environments,
      currentEnvironmentId:this.world.environment?.id || null
    });
  }

  matches(item, query) {
    if (!query) return true;
    return [item.id,item.label,item.type,item.description,item.source,item.mime,item.provider,...(item.tags || [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  }

  render() {
    this.revokeObjectUrls();
    const resources = this.snapshot()[this.kind] || [];
    const query = this.search.value.trim().toLowerCase();
    const visible = resources.filter((item) => this.matches(item, query));
    this.list.replaceChildren();
    if (!visible.length) {
      const empty = el('div','resource-empty');
      empty.append(el('strong','',`暂无 ${this.kind}`),el('span','',this.kind === 'assets' ? '生成或编译 GLB 后会出现在这里。' : '导入对应 Artifact 后会出现在这里。'));
      this.list.append(empty);
      return;
    }
    for (const item of visible) {
      if (this.kind === 'assets') this.list.append(this.assetCard(item));
      else if (this.kind === 'images') this.list.append(this.imageCard(item));
      else this.list.append(this.worldCard(item));
    }
  }

  assetCard(asset) {
    const card = el('article','resource-card resource-asset-card');
    card.draggable = true;
    card.dataset.assetId = asset.id;
    const top = el('div','resource-card-top');
    const title = el('div','resource-card-title');
    title.append(el('strong','',asset.label || asset.id),el('code','',asset.id));
    top.append(title,el('span','resource-pill',asset.source));
    const meta = el('div','resource-card-meta',metaLine(asset.type,(asset.actions || []).slice(0,4).join(' / ')));
    const actions = el('div','resource-card-actions');
    const place = el('button','resource-action','放到视口中心');
    place.type = 'button';
    place.addEventListener('click', async () => {
      try { await this.placement.placeAtCenter(asset.id); }
      catch (error) { this.log(`放置资产失败：${error.message}`,'error'); }
    });
    actions.append(place,el('span','resource-drag-hint','拖到场景中放置'));
    card.append(top,meta,actions);
    card.addEventListener('dragstart', (event) => {
      if (!this.placement.beginDrag(asset.id)) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData?.(ASSET_DRAG_MIME,asset.id);
      event.dataTransfer?.setData?.('text/plain',asset.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      this.placement.cancelDrag();
    });
    return card;
  }

  imageCard(image) {
    const card = el('article','resource-card resource-image-card');
    const preview = el('div','resource-image-preview');
    const entry = localArtifactEntry(this.world,image.descriptor);
    if (entry?.data) {
      const url = URL.createObjectURL(new Blob([entry.data],{type:image.mime}));
      this.objectUrls.add(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = image.label || image.id;
      preview.append(img);
    } else preview.append(el('span','',image.format?.toUpperCase() || 'IMAGE'));
    const copy = el('div','resource-card-copy');
    const title = el('div','resource-card-title');
    title.append(el('strong','',image.label || image.id),el('code','',image.id));
    copy.append(title,el('div','resource-card-meta',metaLine(image.mime,image.provider,image.integrity,`${Math.ceil((image.bytes || 0)/1024)} KiB`)));
    card.append(preview,copy);
    return card;
  }

  worldCard(worldResource) {
    const card = el('article','resource-card resource-world-card');
    const top = el('div','resource-card-top');
    const title = el('div','resource-card-title');
    title.append(el('strong','',worldResource.label || worldResource.id),el('code','',worldResource.id));
    top.append(title,el('span','resource-pill',worldResource.current ? 'CURRENT' : worldResource.source));
    card.append(top,el('div','resource-card-meta',worldResource.source === 'generated'
      ? metaLine(worldResource.provider,worldResource.integrity,worldResource.jobId)
      : metaLine(worldResource.number,worldResource.description)));
    if (worldResource.source === 'builtin' && !worldResource.current && this.openEnvironment) {
      const actions = el('div','resource-card-actions');
      const open = el('button','resource-action','打开世界');
      open.type = 'button';
      open.addEventListener('click', () => this.openEnvironment(worldResource.id));
      actions.append(open);
      card.append(actions);
    } else if (worldResource.source === 'generated') {
      if (this.openGeneratedWorld) {
        const actions = el('div','resource-card-actions');
        const open = el('button','resource-action','替换当前环境');
        open.type = 'button';
        open.addEventListener('click', async () => {
          open.disabled = true;
          try { await this.openGeneratedWorld(worldResource.id); }
          catch (error) { this.log(`打开生成世界失败：${error.message}`,'error'); }
          finally { open.disabled = false; }
        });
        actions.append(open);
        card.append(actions);
      } else card.append(el('div','resource-card-note','World Artifact 已保存，但当前工作区不支持替换环境。'));
    }
    return card;
  }

  revokeObjectUrls() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  destroy() {
    this.revokeObjectUrls();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers = [];
  }
}
