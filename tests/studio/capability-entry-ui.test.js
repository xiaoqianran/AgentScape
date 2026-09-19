import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeveloperSettingsView } from '../../apps/studio/react/developer/DeveloperSettingsView';
import { GenerationJobCenterView } from '../../apps/studio/react/generation/GenerationJobCenterView';

describe('capability-oriented product UI', () => {
  it('shows capability truth without exposing deployment adapter addresses', () => {
    const html=renderToStaticMarkup(createElement(DeveloperSettingsView));
    expect(html).not.toContain('gateway-endpoint');
    expect(html).not.toContain('compiler-endpoint');
    expect(html).not.toContain('asset-generator-endpoint');
    expect(html).toContain('能力状态');
    expect(html).toContain('智能体能力');
    expect(html).toContain('资产编译能力');
    expect(html).toContain('资产生成能力');
    expect(html).toContain('适配器地址和凭据');
    expect(html).not.toContain('服务状态');
  });

  it('presents Connector pairing without exposing or editing its URL', () => {
    const html=renderToStaticMarkup(createElement(GenerationJobCenterView));
    expect(html).not.toContain('generation-connector-endpoint');
    expect(html).not.toContain('generation-save-endpoint');
    expect(html).toContain('<summary>连接器</summary>');
    expect(html).toContain('提供方能力由连接器动态发现');
  });
});
