import '../../ui/generation/GenerationJobCenter.css';

export function GenerationJobCenterView() {
  return (
    <section className="generation-console" aria-label="生成任务中心">
      <div className="generation-heading">
        <div>
          <div className="eyebrow">创建</div>
          <h2>创建资产</h2>
          <p>生成内容、完成验证，然后将资产加入当前世界。</p>
        </div>
        <span id="generation-connector-badge" className="generation-badge">连接器</span>
      </div>

      <div id="generation-state" className="generation-state" data-state="ready">
        <strong id="generation-state-label">检查生成能力</strong>
        <span id="generation-state-detail">连接连接器后从能力快照发现生成能力。</span>
      </div>

      <div className="generation-scroll">
        <details className="generation-section">
          <summary>连接器</summary>
          <div className="generation-section-body">
            <div className="generation-inline-actions">
              <button id="generation-pair" type="button">配对 / 恢复</button>
              <button id="generation-revoke" type="button" className="danger">撤销</button>
            </div>
            <small>连接器只暴露规范化能力、任务与产物，不向 AgentScape 暴露提供方私有凭据。</small>
            <small id="generation-pairing-hint">提供方能力由连接器动态发现。</small>
          </div>
        </details>

        <details className="generation-section" open>
          <summary>创建设置</summary>
          <div className="generation-section-body">
            <label>提供方<select id="generation-provider" /></label>
            <label>能力<select id="generation-operation" /></label>
            <div id="generation-capability-hint" className="generation-capability-hint">暂无可用生成能力。</div>
            <label>配置档<input id="generation-profile" placeholder="可选配置档" /></label>
            <label>输入参数<textarea id="generation-inputs" rows={4} spellCheck={false} defaultValue={'{"prompt":""}'} /></label>
            <small>输入参数遵循所选能力的契约；更底层的提供方信息仍可按需查看。</small>
            <label>资产 ID<input id="generation-asset-id" placeholder="generated_asset_01" /></label>
            <label className="generation-confirm"><input id="generation-cost-confirm" type="checkbox" />我确认生成可能使用外部计算资源并产生费用。</label>
            <button id="generation-submit" type="button" className="generation-primary">开始生成</button>
            <small>这里只显示提供方声明的成本等级和时长等级，不伪造价格或耗时；确认状态不会跨生成任务持久化。</small>
          </div>
        </details>

        <details id="generation-jobs-disclosure" className="generation-section generation-jobs-section">
          <summary>最近生成任务</summary>
          <div className="generation-section-body">
            <div className="generation-section-title">
              <small>提供方生成任务历史</small>
              <button id="generation-refresh" type="button">刷新</button>
            </div>
            <div id="generation-job-list" className="generation-job-list" />
          </div>
        </details>

        <details id="generation-result-disclosure" className="generation-section">
          <summary>结果 / 详情 <small id="generation-selected-id">未选择</small></summary>
          <div className="generation-section-body">
            <div id="generation-job-detail" className="generation-job-detail">选择一个生成任务，查看进度、产物完整性与世界就绪状态。</div>
            <label>编译资产 ID<input id="generation-compile-asset-id" placeholder="generated_asset_01" /></label>
            <div className="generation-inline-actions generation-job-actions">
              <button id="generation-job-refresh" type="button">刷新任务</button>
              <button id="generation-job-cancel" type="button">取消</button>
              <button id="generation-job-import" type="button">导入产物</button>
              <button id="generation-job-compile" type="button">编译 / 注册</button>
            </div>
            <div className="generation-inline-actions generation-product-actions">
              <button id="generation-job-spawn" type="button" disabled>加入世界</button>
            </div>
            <div id="generation-result-report" className="generation-result-report">生成完成不代表可以直接进入世界；必须先通过编译与准入检查，才能加入世界。</div>
          </div>
        </details>
      </div>
    </section>
  );
}
