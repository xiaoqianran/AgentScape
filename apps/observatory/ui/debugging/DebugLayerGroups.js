export const DEBUG_LAYER_GROUPS = Object.freeze([
  ['physics', '物理 / 碰撞', ['native','manifest','difference','normalized','velocity','joint','contact']],
  ['navigation', '导航 / 空间', ['bounds','ray','spatial-query','navmesh','path','endpoints','obstacles']],
  ['interaction', '交互 / Agent', ['interaction-los','interaction-support','interaction-state','agent-tool']],
  ['common', '通用显示', ['labels','grid']]
]);

export function mountDebugLayerGroups(container) {
  return DEBUG_LAYER_GROUPS.map(([key, title, layers]) => {
    const section = document.createElement('section');
    section.className = 'obs-layer-group';
    section.dataset.layerGroup = key;
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    for (const layer of layers) {
      const row = container.querySelector(`[data-debug-layer="${layer}"]`);
      if (row) section.append(row);
    }
    container.append(section);
    return section;
  });
}
