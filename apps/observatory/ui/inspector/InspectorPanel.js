import {inspectorProfileForLab} from './InspectorProfiles.js';

export function configureInspectorPanel(root, labId) {
  const profile = inspectorProfileForLab(labId);
  const heading = root.querySelector('[data-right-panel="inspect"] .obs-panel-heading');
  heading.querySelector('strong').textContent = profile.title;
  heading.querySelector('small').textContent = profile.description;
  root.querySelector('#obs-metrics').previousElementSibling.querySelector('strong').textContent = profile.metrics;
  root.querySelectorAll('[data-gpu-diagnostics]').forEach(element => { element.hidden = !profile.gpu; });
  root.querySelector('[data-right-tab="inspect"] span').textContent = labId === 'rendering' ? '渲染' : '检视';
  return profile;
}

export function renderInspectorPanel(inspector, escapeHtml, displayKey, formatValue) {
  if (!inspector) return '<div class="obs-empty">运行场景后显示关键 Runtime 状态。</div>';
  const rows = Object.entries(inspector.values || {}).map(([key, value]) => `<div class="obs-kv"><span>${escapeHtml(displayKey(key))}</span><b>${escapeHtml(formatValue(value))}</b></div>`).join('');
  return `<div class="obs-inspector-head"><span>对象 / 系统</span><b>${escapeHtml(inspector.title || 'Runtime')}</b><small>${escapeHtml(inspector.kind || '')}</small></div>${rows}`;
}
