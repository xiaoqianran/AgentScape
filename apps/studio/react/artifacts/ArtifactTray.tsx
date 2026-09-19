import { useEffect, useState } from 'react';
import { useStudioStore, type BuildOutputRef } from '../state/studioStore';
import { executeArtifactTrayAction, type ArtifactTrayActionController } from '../../artifacts/artifactTrayActions';
import './ArtifactTray.css';
import './ArtifactTrayAgentTest.css';

type ArtifactDescriptor = {
  id?: string;
  mime?: string;
  role?: string;
  format?: string;
  integrity?: { state?: string };
  locations?: Array<{
    kind?: string;
    state?: string;
    access?: { kind?: string; key?: string };
  }>;
};

type StudioResourcesLike = {
  localArtifact: (id: string) => { descriptor?: ArtifactDescriptor | null; data?: Uint8Array | null };
  approvedAssetIds: () => Set<string>;
  approveAsset: (assetId: string, metadata?: Record<string, unknown>) => Promise<unknown>;
  onChange: (listener: (type: string) => void) => (() => void);
};

type AgentVerificationStep = {
  id: string;
  label: string;
  tool: string;
  state: string;
  status?: string | null;
  reason?: string | null;
};

type AgentVerificationResult = {
  status: 'verified' | 'failed';
  targetId: string;
  supportId: string;
  surfaceId?: string | null;
  failedStep?: string | null;
  reason?: string | null;
  durationMs?: number;
  steps: AgentVerificationStep[];
};

type AgentVerifierLike = {
  supportTargets: () => Array<{ id: string; label: string; surfaces: string[] }>;
  run: (options: {
    targetId: string;
    supportId?: string | null;
    surfaceId?: string | null;
    onStep?: (step: AgentVerificationStep, steps: AgentVerificationStep[]) => void;
  }) => Promise<AgentVerificationResult>;
};

type ArtifactTrayProps = {
  resources: StudioResourcesLike;
  controller: ArtifactTrayActionController;
  agentVerifier: AgentVerifierLike;
  openBuild: () => void;
  log: (text: string, kind?: string) => void;
};

function outputLabel(output: BuildOutputRef) {
  if (output.prompt.trim()) return output.prompt.trim();
  if (output.kind === 'image') return 'Generated Image';
  if (output.kind === 'asset') return 'Generated Asset';
  return 'Generated World';
}

function outputKindLabel(output: BuildOutputRef) {
  if (output.kind === 'image') return 'IMAGE';
  if (output.kind === 'asset') return '3D ASSET';
  return 'WORLD';
}

function outputMeta(output: BuildOutputRef) {
  const artifactCount = output.artifactIds.length;
  const artifactText = artifactCount === 1 ? '1 artifact' : `${artifactCount} artifacts`;
  return [output.status, output.routeLabel, artifactText].filter(Boolean).join(' · ');
}

function outputActionLabel(output: BuildOutputRef, busy: boolean) {
  if (busy) return output.kind === 'asset' ? '放置中…' : output.kind === 'world' ? '打开中…' : '准备中…';
  if (output.kind === 'image') return '继续 → 3D';
  if (output.kind === 'asset') return '放入世界';
  return '打开世界';
}

function localArtifactEntry(resources: StudioResourcesLike, artifactId: string) {
  const local = resources.localArtifact(artifactId);
  return local?.descriptor ? {
    descriptor:local.descriptor,
    entry:local.data ? { data:local.data } : null
  } : null;
}

function ArtifactThumbnail({ resources, output, revision }: { resources: StudioResourcesLike; output: BuildOutputRef; revision: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (output.kind !== 'image' || !output.artifactIds[0]) {
      setUrl(null);
      return;
    }
    const local = localArtifactEntry(resources, output.artifactIds[0]);
    if (!local?.entry?.data) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([local.entry.data as BlobPart], {
      type: local.descriptor?.mime || 'image/png'
    }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [output.artifactIds, output.kind, resources, revision]);

  if (url) return <img src={url} alt="" />;
  return <span>{output.kind === 'image' ? '2D' : output.kind === 'asset' ? '3D' : 'ENV'}</span>;
}

export function ArtifactTrayView({ resources, controller, agentVerifier, openBuild, log }: ArtifactTrayProps) {
  const outputs = useStudioStore((state) => state.buildOutputs);
  const selectedKey = useStudioStore((state) => state.selectedBuildOutputKey);
  const selectOutput = useStudioStore((state) => state.selectBuildOutput);
  const clearOutputs = useStudioStore((state) => state.clearBuildOutputs);
  const requestBuildWorkflow = useStudioStore((state) => state.requestBuildWorkflow);
  const [collapsed, setCollapsed] = useState(() => outputs.length === 0);
  const [artifactRevision, setArtifactRevision] = useState(0);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [placedInstances, setPlacedInstances] = useState<Record<string, string>>({});
  const [supportByOutput, setSupportByOutput] = useState<Record<string, string>>({});
  const [verificationByOutput, setVerificationByOutput] = useState<Record<string, AgentVerificationResult | { status:'running'; steps:AgentVerificationStep[] }>>({});

  useEffect(() => {
    if (outputs.length) setCollapsed(false);
  }, [outputs.length]);

  useEffect(() => resources.onChange((type) => {
    setArtifactRevision((value) => value + 1);
    if (type === 'environment.replaced') {
      setPlacedInstances({});
      setVerificationByOutput({});
    }
  }), [resources]);

  const approvedIds = resources.approvedAssetIds();
  void libraryRevision;

  const saveAsset = async (output: BuildOutputRef) => {
    if (output.kind !== 'asset') return;
    setBusyKey(`library:${output.key}`);
    try {
      await resources.approveAsset(output.primaryId, { label:outputLabel(output) });
      setLibraryRevision((value) => value + 1);
      log(`已保存到本地资产库：${output.primaryId}`, 'result');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`保存资产失败：${message}`, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const runOutputAction = async (output: BuildOutputRef) => {
    selectOutput(output.key);
    if (output.kind !== 'image') setBusyKey(output.key);
    try {
      const result = await executeArtifactTrayAction({ output, controller, requestBuildWorkflow, openBuild });
      if (result.status === 'workflow-prepared') log(`已将 Image 送入 3D Build：${result.id}`, 'plan');
      else if (result.status === 'asset-placed') {
        setPlacedInstances((state) => ({ ...state, [output.key]:result.instanceId }));
        log(`Artifact Tray 已放置 Asset：${result.id} → ${result.instanceId}`, 'result');
      } else log(`Artifact Tray 已打开 World：${result.id}`, 'result');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Artifact Tray 操作失败：${message}`, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const runAgentVerification = async (output: BuildOutputRef, instanceId: string) => {
    const supports = agentVerifier.supportTargets().filter((item) => item.id !== instanceId);
    const supportId = supportByOutput[output.key] || supports[0]?.id || null;
    setBusyKey(`agent:${output.key}`);
    setVerificationByOutput((state) => ({ ...state, [output.key]:{ status:'running', steps:[] } }));
    try {
      const result = await agentVerifier.run({
        targetId:instanceId,
        supportId,
        onStep:(_step, steps) => setVerificationByOutput((state) => ({ ...state, [output.key]:{ status:'running', steps } }))
      });
      setVerificationByOutput((state) => ({ ...state, [output.key]:result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVerificationByOutput((state) => ({
        ...state,
        [output.key]:{ status:'failed', targetId:instanceId, supportId:supportId || '', reason:message, steps:[] }
      }));
      log(`Agent Asset Test 启动失败：${message}`, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className={`artifact-tray${collapsed ? ' is-collapsed' : ''}`} aria-label="Artifact Tray">
      <header className="artifact-tray-header">
        <div className="artifact-tray-title">
          <span>RECENT OUTPUTS</span>
          <small>{outputs.length}</small>
        </div>
        <div className="artifact-tray-actions">
          {outputs.length ? <button type="button" onClick={clearOutputs}>清空</button> : null}
          <button type="button" aria-label={collapsed ? '展开 Artifact Tray' : '折叠 Artifact Tray'} onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '＋' : '−'}
          </button>
        </div>
      </header>

      {!collapsed ? (
        <div className="artifact-tray-scroll">
          {!outputs.length ? (
            <div className="artifact-tray-empty">
              <strong>Recent outputs</strong>
              <span>最近的 Image、3D Asset 和 World 会出现在这里；长期资源请到 Library。</span>
            </div>
          ) : outputs.map((output) => {
            const busy = busyKey === output.key;
            const instanceId = placedInstances[output.key] || null;
            const supports = output.kind === 'asset' ? agentVerifier.supportTargets().filter((item) => item.id !== instanceId) : [];
            const verification = verificationByOutput[output.key];
            const agentBusy = busyKey === `agent:${output.key}`;
            const libraryBusy = busyKey === `library:${output.key}`;
            const assetApproved = output.kind === 'asset' && approvedIds.has(output.primaryId);
            return (
              <article key={output.key} className={`artifact-tray-item${selectedKey === output.key ? ' active' : ''}${instanceId ? ' has-agent-test' : ''}`}>
                <button type="button" className="artifact-tray-select" onClick={() => selectOutput(output.key)} title={output.primaryId}>
                  <span className="artifact-tray-thumb">
                    <ArtifactThumbnail resources={resources} output={output} revision={artifactRevision} />
                  </span>
                  <span className="artifact-tray-copy">
                    <small>{outputKindLabel(output)}</small>
                    <strong>{outputLabel(output)}</strong>
                    <code>{output.primaryId}</code>
                    <em>{outputMeta(output)}</em>
                  </span>
                </button>
                <button type="button" className="artifact-tray-continue" disabled={Boolean(busyKey)} onClick={() => void runOutputAction(output)}>
                  {outputActionLabel(output, busy)}
                </button>
                {output.kind === 'asset' ? (
                  <button
                    type="button"
                    className="artifact-tray-save"
                    disabled={Boolean(busyKey) || assetApproved}
                    onClick={() => void saveAsset(output)}
                  >
                    {assetApproved ? '已保存到 Library' : libraryBusy ? '保存中…' : '保存到 Library'}
                  </button>
                ) : null}
                {output.kind === 'asset' && instanceId ? (
                  <div className="artifact-tray-agent-test">
                    <div className="artifact-tray-agent-row">
                      <span>AGENT TEST</span>
                      <select
                        aria-label={`Agent Test support for ${instanceId}`}
                        value={supportByOutput[output.key] || supports[0]?.id || ''}
                        disabled={agentBusy || !supports.length}
                        onChange={(event) => setSupportByOutput((state) => ({ ...state, [output.key]:event.target.value }))}
                      >
                        {supports.map((support) => <option key={support.id} value={support.id}>{support.label} · {support.id}</option>)}
                      </select>
                      <button type="button" disabled={Boolean(busyKey) || !supports.length} onClick={() => void runAgentVerification(output, instanceId)}>
                        {agentBusy ? '验证中…' : verification?.status === 'verified' ? '重新验证' : '运行验证'}
                      </button>
                    </div>
                    {verification ? (
                      <div className={`artifact-tray-agent-result ${verification.status}`}>
                        <strong>{verification.status === 'running' ? 'RUNNING' : verification.status.toUpperCase()}</strong>
                        <span>{verification.steps.map((step) => `${step.id}:${step.state}`).join(' · ') || ('reason' in verification ? verification.reason : '')}</span>
                      </div>
                    ) : <small>真实 Navigate → Pickup → Carry → Place → Verify</small>}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
