import { describe, expect, it } from 'vitest';
import { generationJobCenterMarkup } from '../generation/orchestration/GenerationJobCenter.js';
import { developerSettingsMarkup } from '../studio/ui/developer/DeveloperSettings.js';

describe('capability-oriented product UI', () => {
  it('shows capability truth without exposing deployment adapter addresses', () => {
    const html=developerSettingsMarkup();
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

  it('presents the local adapter as optional and never asks for its URL', () => {
    const html=generationJobCenterMarkup();
    expect(html).not.toContain('generation-connector-endpoint');
    expect(html).not.toContain('generation-save-endpoint');
    expect(html).toContain('本地适配器（可选）');
    expect(html).toContain('普通服务器能力不依赖本地适配器');
  });
});
