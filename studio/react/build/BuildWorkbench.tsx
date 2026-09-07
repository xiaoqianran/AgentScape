import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BUILD_MODE_META, BUILD_MODES } from '../../build/BuildSession.js';
import { useStudioStore, type BuildOutputRef } from '../state/studioStore';
import './BuildWorkbench.css';

type BuildMode = 'image' | 'asset' | 'world';

type BuildStep = {
  id: string;
  label: string;
  status: string;
  detail: string | null;
};

type BuildError = {
  code: string | null;
  message: string;
};

type ImageBuildResult = {
  kind: 'image';
  prompt?: string;
  artifactId: string;
  artifact?: { id?: string; mime?: string; role?: string; hash?: string };
  jobId?: string;
};

type AssetBuildResult = {
  kind: 'asset';
  prompt?: string;
  assetId: string;
  status: string;
  asset?: { label?: string; artifactId?: string };
};

type WorldBuildResult = {
  kind: 'world';
  prompt?: string;
  manifestArtifactId: string;
  artifacts?: Record<string, string | null>;
};

type BuildResult = ImageBuildResult | AssetBuildResult | WorldBuildResult;

type BuildState = {
  mode: BuildMode;
  status: string;
  prompt: string;
  result: BuildResult | null;
  error: BuildError | null;
  steps: BuildStep[];
};

type CapabilityState = {
  paired: boolean;
  image: boolean;
  asset: boolean;
  world: boolean;
  discovered?: Partial<Record<BuildMode, boolean>>;
};

type BuildSessionLike = {
  onChange: (state: BuildState) => void;
  snapshot: () => BuildState;
  setMode: (mode: BuildMode) => unknown;
  begin: (prompt: string, options?: { mode?: BuildMode }) => unknown;
  stage: (index: number, detail?: string | null) => unknown;
  complete: (result: BuildResult) => unknown;
  fail: (error: unknown) => unknown;
};

type BuildControllerLike = {
  capabilities: () => CapabilityState;
  connect: (options?: { pairingId?: string | null }) => Promise<{ status?: string; reason?: string; pairingId?: string }>;
  generateImage: (options: { prompt: string; onProgress?: (job: any) => void }) => Promise<ImageBuildResult>;
  generateAsset: (options: { prompt: string; assetId?: string | null; onProgress?: (job: any) => void }) => Promise<AssetBuildResult>;
  generateAssetFromImage: (options: { imageResult: ImageBuildResult; assetId?: string | null; onProgress?: (job: any) => void }) => Promise<AssetBuildResult>;
  generateWorld: (options: { prompt: string; onProgress?: (job: any) => void }) => Promise<WorldBuildResult>;
  placeAsset: (assetId: string) => Promise<unknown>;
  openWorld: (manifestArtifactId: string) => Promise<unknown>;
};

type WorldLike = {
  environment?: { id?: string; title?: string; label?: string } | null;
  generationState?: unknown;
  generation?: {
    artifacts?: {
      registry?: { get?: (id: string) => any };
      byteStore?: { get?: (key: string) => any };
    };
  };
  events: {
    on: (type: string, listener: () => void) => (() => void) | undefined;
  };
};

type EnvironmentDefinition = {
  id?: string;
  title?: string;
};

type BuildWorkbenchProps = {
  root: HTMLElement;
  world: WorldLike;
  session: BuildSessionLike;
  controller: BuildControllerLike;
  environmentDefinition?: EnvironmentDefinition | null;
  log?: (text: string, kind?: string) => void;
};

function localArtifactEntry(world: WorldLike, artifactId: string) {
  const descriptor = world.generation?.artifacts?.registry?.get?.(artifactId);
  const location = descriptor?.locations?.find?.((item: any) =>
    item.kind === 'local-cache' && item.state === 'available' && item.access?.kind === 'cache-key'
  );
  return location ? world.generation?.artifacts?.byteStore?.get?.(location.access.key) ?? null : null;
}

function capabilityText(caps: CapabilityState, mode: BuildMode) {
  if (!caps.paired) return '生成连接器尚未连接；连接后自动发现 Provider 能力。';
  if (caps[mode]) return `${BUILD_MODE_META[mode].label} 路由已就绪。Provider 由能力快照自动选择。`;
  if (caps.discovered?.[mode]) return `${BUILD_MODE_META[mode].label} 能力已发现，但 Provider 当前 Offline / Disabled；连接 Provider Runtime 后会自动变为 Ready。`;
  return `当前能力快照没有可用的 ${BUILD_MODE_META[mode].label} 路由。`;
}

function generateLabel(mode: BuildMode) {
  if (mode === 'image') return 'Generate Image';
  if (mode === 'world') return 'Generate World';
  return 'Generate 3D';
}

function resultErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function buildOutputRef(result: BuildResult): BuildOutputRef {
  const createdAt = Date.now();
  if (result.kind === 'image') {
    return {
      key: `image:${result.artifactId}`,
      kind: 'image',
      primaryId: result.artifactId,
      artifactIds: [result.artifactId],
      prompt: result.prompt || '',
      status: 'ready',
      createdAt
    };
  }
  if (result.kind === 'asset') {
    const artifactIds = result.asset?.artifactId ? [result.asset.artifactId] : [];
    return {
      key: `asset:${result.assetId}`,
      kind: 'asset',
      primaryId: result.assetId,
      artifactIds,
      prompt: result.prompt || '',
      status: result.status,
      createdAt
    };
  }
  return {
    key: `world:${result.manifestArtifactId}`,
    kind: 'world',
    primaryId: result.manifestArtifactId,
    artifactIds: Object.values(result.artifacts || {}).filter((value): value is string => Boolean(value)),
    prompt: result.prompt || '',
    status: 'ready',
    createdAt
  };
}

function imageBuildResultFromOutput(world: WorldLike, output: BuildOutputRef): ImageBuildResult {
  if (output.kind !== 'image') throw new Error('只有 Image Build output 可以作为 Image → 3D 输入');
  const descriptor = world.generation?.artifacts?.registry?.get?.(output.primaryId);
  if (!descriptor?.id || !descriptor?.hash) throw new Error(`Image Artifact 不可用：${output.primaryId}`);
  return {
    kind:'image',
    prompt:output.prompt,
    artifactId:descriptor.id,
    artifact:{ id:descriptor.id, mime:descriptor.mime, role:descriptor.role, hash:descriptor.hash },
    jobId:descriptor.producer?.jobId || undefined
  };
}

function ImageResultView({
  world,
  result,
  onGenerate3D
}: {
  world: WorldLike;
  result: ImageBuildResult;
  onGenerate3D: (result: ImageBuildResult) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const entry = localArtifactEntry(world, result.artifactId);
    if (!entry?.data) {
      setPreviewUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([entry.data as BlobPart], { type: result.artifact?.mime || 'image/png' }));
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [result.artifact?.mime, result.artifactId, world]);

  return (
    <>
      <div className="build-result-body">
        {previewUrl ? (
          <div className="build-image-preview">
            <img src={previewUrl} alt={result.prompt || result.artifactId} />
          </div>
        ) : null}
        <div className="build-result-copy">
          <strong>{result.prompt || 'Generated Image'}</strong>
          <code>{result.artifactId}</code>
        </div>
      </div>
      <div className="build-result-actions">
        <button type="button" className="build-result-primary" onClick={() => onGenerate3D(result)}>生成 3D</button>
      </div>
    </>
  );
}

function AssetResultView({
  controller,
  result,
  log
}: {
  controller: BuildControllerLike;
  result: AssetBuildResult;
  log: (text: string, kind?: string) => void;
}) {
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(false);

  const place = async () => {
    setPlacing(true);
    try {
      await controller.placeAsset(result.assetId);
      log(`Build Asset 已加入当前世界：${result.assetId}`, 'result');
      setPlaced(true);
    } catch (error) {
      log(`Build Asset 放置失败：${resultErrorMessage(error)}`, 'error');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <>
      <div className="build-result-body">
        <div className="build-result-copy">
          <strong>{result.asset?.label || result.prompt || result.assetId}</strong>
          <code>{result.assetId}</code>
          <small>{result.status === 'asset-provisional' ? 'Asset provisional · 可进入当前工作区验证' : 'Asset ready · 已编译并注册'}</small>
        </div>
      </div>
      <div className="build-result-actions">
        <button type="button" className="build-result-primary" disabled={placing} onClick={() => void place()}>
          {placed ? '已加入世界' : placing ? '加入中…' : '加入当前世界'}
        </button>
      </div>
    </>
  );
}

function WorldResultView({
  controller,
  result,
  log
}: {
  controller: BuildControllerLike;
  result: WorldBuildResult;
  log: (text: string, kind?: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const artifactCount = Object.values(result.artifacts || {}).filter(Boolean).length;

  const open = async () => {
    setOpening(true);
    try {
      await controller.openWorld(result.manifestArtifactId);
      log(`Build World 已打开：${result.manifestArtifactId}`, 'result');
      setOpened(true);
    } catch (error) {
      log(`Build World 打开失败：${resultErrorMessage(error)}`, 'error');
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <div className="build-result-body">
        <div className="build-result-copy">
          <strong>{result.prompt || 'Generated World'}</strong>
          <code>{result.manifestArtifactId}</code>
          <small>{artifactCount} artifacts · World bundle ready</small>
        </div>
      </div>
      <div className="build-result-actions">
        <button type="button" className="build-result-primary" disabled={opening} onClick={() => void open()}>
          {opened ? '当前世界' : opening ? '打开中…' : '打开为当前世界'}
        </button>
      </div>
    </>
  );
}

function BuildWorkbenchView({
  root,
  world,
  session,
  controller,
  environmentDefinition = null,
  log = () => {}
}: BuildWorkbenchProps) {
  const recordBuildOutput = useStudioStore((store) => store.recordBuildOutput);
  const buildOutputs = useStudioStore((store) => store.buildOutputs);
  const workflowIntent = useStudioStore((store) => store.buildWorkflowIntent);
  const consumeBuildWorkflow = useStudioStore((store) => store.consumeBuildWorkflow);
  const [state, setState] = useState<BuildState>(() => session.snapshot());
  const [prompt, setPrompt] = useState('');
  const [assetId, setAssetId] = useState('');
  const [assetSource, setAssetSource] = useState<ImageBuildResult | null>(null);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  const [environmentRevision, setEnvironmentRevision] = useState(0);
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);

  useEffect(() => {
    session.onChange = (next) => setState(next);
    setState(session.snapshot());
    return () => {
      session.onChange = () => {};
    };
  }, [session]);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    const generationUnsubscribe = world.events.on('generation.state', () => {
      setCapabilityNotice(null);
      setCapabilityRevision((value) => value + 1);
    });
    const environmentUnsubscribe = world.events.on('environment.replaced', () => {
      setEnvironmentRevision((value) => value + 1);
    });
    if (generationUnsubscribe) unsubscribers.push(generationUnsubscribe);
    if (environmentUnsubscribe) unsubscribers.push(environmentUnsubscribe);
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [world]);

  useEffect(() => {
    root.dataset.buildMode = state.mode;
  }, [root, state.mode]);

  useEffect(() => {
    if (!workflowIntent) return;
    if (workflowIntent.action === 'asset-from-image') {
      const output = buildOutputs.find((item) => item.key === workflowIntent.outputKey);
      try {
        if (!output) throw new Error('找不到对应的 Image Build output');
        const source = imageBuildResultFromOutput(world, output);
        session.setMode('asset');
        setPrompt(source.prompt || 'Image to 3D');
        setAssetSource(source);
        setCostConfirmed(false);
        setCapabilityNotice('已选择 Image Artifact 作为 3D 输入。确认外部生成计算资源后即可 Generate 3D。');
      } catch (error) {
        const message = resultErrorMessage(error);
        setCapabilityNotice(message);
        log(`准备 Image → 3D 失败：${message}`, 'error');
      } finally {
        consumeBuildWorkflow(workflowIntent.id);
      }
    }
  }, [buildOutputs, consumeBuildWorkflow, log, session, workflowIntent, world]);

  const caps = useMemo(() => controller.capabilities(), [controller, capabilityRevision, state.mode, state.status]);
  const meta = BUILD_MODE_META[state.mode];
  const running = state.status === 'running';
  const generateDisabled = running || !caps.paired || !caps[state.mode] || !costConfirmed || !prompt.trim();

  const environment = world.environment;
  void environmentRevision;
  const builtinTitle = environment?.id === environmentDefinition?.id ? environmentDefinition?.title : null;
  const worldName = environment?.title || environment?.label || builtinTitle || environment?.id || 'Current World';
  const worldId = environment?.id || 'environment';

  const connect = async () => {
    setConnecting(true);
    setCapabilityNotice(null);
    try {
      const result = await controller.connect({ pairingId });
      if (result.status === 'generation-ready') {
        setPairingId(null);
        world.generationState = structuredClone(result);
        log('Build 生成连接器已就绪', 'result');
      } else if (result.reason === 'APPROVAL_REQUIRED') {
        const nextPairingId = result.pairingId || pairingId;
        setPairingId(nextPairingId || null);
        log(`Build 等待连接器批准：${nextPairingId || 'unknown'}`, 'plan');
      }
      setCapabilityRevision((value) => value + 1);
    } catch (error) {
      const message = resultErrorMessage(error);
      log(`Build 连接器失败：${message}`, 'error');
      setCapabilityNotice(message);
    } finally {
      setConnecting(false);
    }
  };

  const generate = async () => {
    const mode = session.snapshot().mode;
    const text = prompt.trim();
    if (!text || !costConfirmed) return;
    const nextAssetId = assetId.trim() || null;
    setCapabilityNotice(null);
    session.begin(text, { mode });
    try {
      let result: BuildResult;
      if (mode === 'image') {
        result = await controller.generateImage({
          prompt: text,
          onProgress: (job) => session.stage(1, job?.stage || job?.phase || job?.status || '生成中')
        });
      } else if (mode === 'asset') {
        result = assetSource
          ? await controller.generateAssetFromImage({
              imageResult:assetSource,
              assetId:nextAssetId,
              onProgress:(job) => session.stage(1, job?.stage || job?.phase || job?.status || '3D 重建中')
            })
          : await controller.generateAsset({
              prompt: text,
              assetId: nextAssetId,
              onProgress: () => session.stage(1, '生成 3D')
            });
      } else {
        result = await controller.generateWorld({
          prompt: text,
          onProgress: () => session.stage(1, '生成参考与世界')
        });
      }
      session.complete(result);
      recordBuildOutput(buildOutputRef(result));
      if (result.kind === 'asset') setAssetSource(null);
      log(`Build 完成：${result.kind}`, 'result');
    } catch (error) {
      session.fail(error);
      log(`Build 失败：${resultErrorMessage(error)}`, 'error');
    } finally {
      setCostConfirmed(false);
    }
  };

  const prepare3DFromImage = (imageResult: ImageBuildResult) => {
    session.setMode('asset');
    setPrompt(imageResult.prompt || 'Image to 3D');
    setAssetSource(imageResult);
    setCostConfirmed(false);
    setCapabilityNotice('已选择 Image Artifact 作为 3D 输入。确认外部生成计算资源后即可 Generate 3D。');
  };

  const setMode = (mode: BuildMode) => {
    if (!BUILD_MODES.includes(mode)) return;
    setCapabilityNotice(null);
    if (mode !== 'asset') setAssetSource(null);
    session.setMode(mode);
  };

  return (
    <section className="build-workbench" aria-label="Build Workbench">
      <header className="build-heading">
        <div>
          <div className="eyebrow">BUILD</div>
          <h1>Build Workbench</h1>
          <p>在当前世界中生成 Image、3D Asset 或完整 World。</p>
        </div>
        <button id="build-open-advanced" className="build-advanced-button" type="button" onClick={() => root.classList.add('build-advanced-open')}>Advanced</button>
      </header>

      <div className="build-world-context">
        <span className="build-context-dot" />
        <div><small>CURRENT WORLD</small><strong id="build-world-name">{worldName}</strong></div>
        <code id="build-world-id">{worldId}</code>
      </div>

      <div className="build-mode-tabs" role="tablist" aria-label="构建类型">
        {(['image', 'asset', 'world'] as const).map((mode) => {
          const available = caps[mode];
          const discovered = !available && Boolean(caps.discovered?.[mode]);
          const active = state.mode === mode;
          const sublabel = mode === 'image' ? '2D' : mode === 'asset' ? '3D' : 'ENV';
          return (
            <button
              key={mode}
              type="button"
              data-build-mode={mode}
              className={[active ? 'active' : '', available ? 'available' : '', discovered ? 'discovered' : ''].filter(Boolean).join(' ')}
              aria-selected={active}
              onClick={() => setMode(mode)}
            >
              <span>{BUILD_MODE_META[mode].label}</span><small>{sublabel}</small>
            </button>
          );
        })}
      </div>

      <div className="build-scroll">
        <section className="build-compose">
          <div className="build-mode-copy">
            <strong id="build-mode-title">{meta.title}</strong>
            <span id="build-mode-description">{meta.description}</span>
          </div>
          <label className="build-prompt-label">Prompt
            <textarea
              id="build-prompt"
              rows={4}
              placeholder="描述你希望生成的内容…"
              spellCheck={false}
              disabled={running}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          {state.mode === 'asset' ? (
            <>
              {assetSource ? (
                <div className="build-source-artifact">
                  <div>
                    <small>IMAGE SOURCE</small>
                    <strong>{assetSource.prompt || 'Generated Image'}</strong>
                    <code>{assetSource.artifactId}</code>
                  </div>
                  <button type="button" disabled={running} onClick={() => setAssetSource(null)}>移除</button>
                </div>
              ) : null}
              <label id="build-asset-id-field" className="build-asset-id-field">Asset ID <span>可选</span>
                <input id="build-asset-id" placeholder="generated_asset_01" disabled={running} value={assetId} onChange={(event) => setAssetId(event.target.value)} />
              </label>
            </>
          ) : null}
          <label className="build-cost-confirm">
            <input id="build-cost-confirm" type="checkbox" disabled={running} checked={costConfirmed} onChange={(event) => setCostConfirmed(event.target.checked)} />
            允许本次 Build 使用外部生成计算资源。
          </label>
          <div className="build-primary-actions">
            {!caps.paired ? (
              <button id="build-connect" type="button" className="build-connect" disabled={connecting} onClick={() => void connect()}>
                {pairingId ? '继续配对' : connecting ? '连接中…' : '连接生成器'}
              </button>
            ) : null}
            <button id="build-generate" type="button" className="build-generate" disabled={generateDisabled} onClick={() => void generate()}>
              {generateLabel(state.mode)}
            </button>
          </div>
          <div id="build-capability-state" className="build-capability-state">{capabilityNotice || capabilityText(caps, state.mode)}</div>
        </section>

        <section className="build-pipeline" aria-label="Build Pipeline">
          <div className="build-section-heading"><span>Pipeline</span><small id="build-status-label">{state.status.toUpperCase()}</small></div>
          <div id="build-step-list" className="build-step-list">
            {state.steps.map((step) => (
              <div key={step.id} className="build-step" data-state={step.status}>
                <span className="build-step-indicator">{step.status === 'completed' ? '✓' : step.status === 'error' ? '!' : '•'}</span>
                <div className="build-step-copy"><strong>{step.label}</strong>{step.detail ? <small>{step.detail}</small> : null}</div>
              </div>
            ))}
          </div>
          {state.error ? <div id="build-error" className="build-error">{state.error.code ? `${state.error.code} · ` : ''}{state.error.message}</div> : null}
        </section>

        {state.result ? (
          <section id="build-result" className="build-result" aria-label="Build Result">
            <div className="build-section-heading"><span>Result</span><small>READY</small></div>
            {state.result.kind === 'image' ? (
              <ImageResultView world={world} result={state.result} onGenerate3D={prepare3DFromImage} />
            ) : state.result.kind === 'asset' ? (
              <AssetResultView controller={controller} result={state.result} log={log} />
            ) : (
              <WorldResultView controller={controller} result={state.result} log={log} />
            )}
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function mountBuildWorkbench(props: BuildWorkbenchProps) {
  if (!props.root || !props.world?.generation || !props.session || !props.controller) {
    throw new TypeError('BuildWorkbench requires root, world, session and controller');
  }
  const host = props.root.querySelector<HTMLElement>('.build-workbench-host');
  if (!host) throw new TypeError('BuildWorkbench requires a .build-workbench-host');
  const reactRoot: Root = createRoot(host);
  reactRoot.render(<BuildWorkbenchView {...props} />);
  return {
    destroy() {
      reactRoot.unmount();
    }
  };
}
