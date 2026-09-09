import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BUILD_MODE_META, BUILD_MODES } from '../../build/BuildSession.js';
import { useStudioStore, type BuildOutputRef } from '../state/studioStore';
import './BuildWorkbench.css';
import { ModelArtifactPreview, WorldArtifactPreview } from './BuildArtifactPreview';
import { LocalImageEditor, type LocalImageEditorHandle } from './LocalImageEditor';

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
  provider?: string | null;
  route?: { provider?: string; operation?: string; profile?: string | null } | null;
  prompt?: string;
  artifactId: string;
  artifact?: { id?: string; mime?: string; role?: string; hash?: string };
  jobId?: string;
};

type AssetBuildResult = {
  kind: 'asset';
  provider?: string | null;
  route?: any;
  prompt?: string;
  assetId: string;
  status: string;
  asset?: { label?: string; artifactId?: string; generation?: { artifactId?: string | null } };
};

type WorldBuildResult = {
  kind: 'world';
  provider?: string | null;
  route?: any;
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

type ProviderOption = { id:string; label:string; operation?:string; profiles?:string[]; recommendedProfile?:string | null };

type BuildControllerLike = {
  capabilities: () => CapabilityState;
  providerOptions: (options: { mode:BuildMode; inputType?:'text' | 'image' }) => ProviderOption[];
  connect: (options?: { pairingId?: string | null }) => Promise<{ status?: string; reason?: string; pairingId?: string }>;
  generateImage: (options: { prompt: string; provider?:string | null; onProgress?: (job: any) => void }) => Promise<ImageBuildResult>;
  approveLocalImage: (options: { bytes: Uint8Array; prompt?: string }) => Promise<ImageBuildResult>;
  generateAsset: (options: { prompt: string; assetId?: string | null; provider?:string | null; onProgress?: (job: any) => void }) => Promise<AssetBuildResult>;
  generateAssetFromImage: (options: { imageResult: ImageBuildResult; assetId?: string | null; provider?:string | null; onProgress?: (job: any) => void }) => Promise<AssetBuildResult>;
  generateWorld: (options: { prompt: string; provider?:string | null; onProgress?: (job: any) => void }) => Promise<WorldBuildResult>;
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

type LocalImageDraft = {
  name: string;
  url: string;
  bytes: Uint8Array;
  width: number;
  height: number;
};

async function localImageDraftFromFile(file: File): Promise<LocalImageDraft> {
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建本地图像处理 Canvas');
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('本地 PNG 转换失败')), 'image/png');
    });
    if (blob.size > 20 * 1024 * 1024) throw new Error('处理后的 PNG 超过 20 MiB，请选择更小的图片');
    return {
      name:file.name,
      url:URL.createObjectURL(blob),
      bytes:new Uint8Array(await blob.arrayBuffer()),
      width:bitmap.width,
      height:bitmap.height
    };
  } finally {
    bitmap.close?.();
  }
}

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

function routeLabel(result: BuildResult) {
  const provider = result.provider || (result.kind === 'world' ? result.route?.world?.provider : result.route?.provider || result.route?.asset?.provider);
  if (!provider) return undefined;
  return String(provider);
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
      routeLabel:routeLabel(result),
      createdAt
    };
  }
  if (result.kind === 'asset') {
    const artifactId = result.asset?.artifactId || result.asset?.generation?.artifactId || null;
    const artifactIds = artifactId ? [artifactId] : [];
    return {
      key: `asset:${result.assetId}`,
      kind: 'asset',
      primaryId: result.assetId,
      artifactIds,
      prompt: result.prompt || '',
      status: result.status,
      routeLabel:routeLabel(result),
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
    routeLabel:routeLabel(result),
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
    jobId:descriptor.producer?.provider === 'local-upload' ? undefined : descriptor.producer?.jobId || undefined
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
          {result.provider ? <small>{result.provider}</small> : null}
        </div>
      </div>
      <div className="build-result-actions">
        <button type="button" className="build-result-primary" onClick={() => onGenerate3D(result)}>生成 3D</button>
      </div>
    </>
  );
}

function AssetResultView({
  world,
  controller,
  result,
  log
}: {
  world: WorldLike;
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
        <ModelArtifactPreview world={world} artifactId={result.asset?.artifactId || result.asset?.generation?.artifactId} label={result.prompt || result.assetId} />
        <div className="build-result-copy">
          <strong>{result.asset?.label || result.prompt || result.assetId}</strong>
          <code>{result.assetId}</code>
          <small>{[result.provider, result.status === 'asset-provisional' ? 'Asset provisional · 可进入当前工作区验证' : 'Asset ready · 已编译并注册'].filter(Boolean).join(' · ')}</small>
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
  world,
  controller,
  result,
  log
}: {
  world: WorldLike;
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
        <WorldArtifactPreview world={world} artifacts={result.artifacts} label={result.prompt || 'Generated World'} />
        <div className="build-result-copy">
          <strong>{result.prompt || 'Generated World'}</strong>
          <code>{result.manifestArtifactId}</code>
          <small>{[result.provider, `${artifactCount} artifacts`, 'World bundle ready'].filter(Boolean).join(' · ')}</small>
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
  const [providerId, setProviderId] = useState('auto');
  const [assetSource, setAssetSource] = useState<ImageBuildResult | null>(null);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  const [environmentRevision, setEnvironmentRevision] = useState(0);
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null);
  const [localImageDraft, setLocalImageDraft] = useState<LocalImageDraft | null>(null);
  const localImageEditorRef = useRef<LocalImageEditorHandle | null>(null);
  const [localImageBusy, setLocalImageBusy] = useState(false);
  const [localImageError, setLocalImageError] = useState<string | null>(null);

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

  useEffect(() => () => {
    if (localImageDraft?.url) URL.revokeObjectURL(localImageDraft.url);
  }, [localImageDraft?.url]);

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
        setProviderId('auto');
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
  const providerInputType = state.mode === 'asset' && assetSource ? 'image' : 'text';
  const providerOptions = useMemo(
    () => controller.providerOptions({ mode:state.mode, inputType:providerInputType }),
    [controller, capabilityRevision, providerInputType, state.mode, state.status]
  );
  const selectedProvider = providerId === 'auto' ? null : providerId;
  const meta = BUILD_MODE_META[state.mode];
  useEffect(() => {
    if (providerId !== 'auto' && !providerOptions.some((provider) => provider.id === providerId)) setProviderId('auto');
  }, [providerId, providerOptions]);
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

  const selectLocalImage = async (file: File | null) => {
    if (!file || localImageBusy) return;
    setLocalImageBusy(true);
    setLocalImageError(null);
    try {
      const draft = await localImageDraftFromFile(file);
      setLocalImageDraft(draft);
      setPrompt(file.name.replace(/\.[^.]+$/, '') || 'Local image');
      setCapabilityNotice('图片仅在本地预览；确认前不会发送到 Connector 或云端。');
    } catch (error) {
      const message = resultErrorMessage(error);
      setLocalImageError(message);
      log(`本地图片读取失败：${message}`, 'error');
    } finally {
      setLocalImageBusy(false);
    }
  };

  const clearLocalImage = () => {
    setLocalImageDraft(null);
    setLocalImageError(null);
    setCapabilityNotice(null);
  };

  const approveLocalImage = async () => {
    if (!localImageDraft || localImageBusy) return;
    if (!caps.paired) {
      setCapabilityNotice('确认图片前请先连接本机 Connector；确认后才会写入本地 Artifact。');
      return;
    }
    setLocalImageBusy(true);
    setLocalImageError(null);
    const label = prompt.trim() || localImageDraft.name.replace(/\.[^.]+$/, '') || 'Local image';
    try {
      const editor = localImageEditorRef.current;
      if (!editor) throw new Error('本地图像编辑器尚未就绪');
      const prepared = await editor.exportPng();
      session.begin(label, { mode:'image' });
      session.stage(1, `Human 已确认最终 RGBA · ${prepared.width}×${prepared.height}`);
      const result = await controller.approveLocalImage({ bytes:prepared.bytes, prompt:label });
      session.stage(2, '最终 RGBA 已保存为本地 Artifact，并发布给本机 Connector');
      session.complete(result);
      recordBuildOutput(buildOutputRef(result));
      setCapabilityNotice('最终 RGBA 已确认并保存，可直接继续 Image → 3D。');
      log(`最终 RGBA 已确认：${localImageDraft.name} · ${prepared.width}×${prepared.height}`, 'result');
    } catch (error) {
      session.fail(error);
      const message = resultErrorMessage(error);
      setLocalImageError(message);
      log(`确认图片失败：${message}`, 'error');
    } finally {
      setLocalImageBusy(false);
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
          provider:selectedProvider,
          onProgress: (job) => session.stage(1, job?.stage || job?.phase || job?.status || '生成中')
        });
      } else if (mode === 'asset') {
        result = assetSource
          ? await controller.generateAssetFromImage({
              imageResult:assetSource,
              assetId:nextAssetId,
              provider:selectedProvider,
              onProgress:(job) => session.stage(1, job?.stage || job?.phase || job?.status || '3D 重建中')
            })
          : await controller.generateAsset({
              prompt: text,
              assetId: nextAssetId,
              provider:selectedProvider,
              onProgress: () => session.stage(1, '生成 3D')
            });
      } else {
        result = await controller.generateWorld({
          prompt: text,
          provider:selectedProvider,
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
    setProviderId('auto');
    setCostConfirmed(false);
    setCapabilityNotice('已选择 Image Artifact 作为 3D 输入。确认外部生成计算资源后即可 Generate 3D。');
  };

  const setMode = (mode: BuildMode) => {
    if (!BUILD_MODES.includes(mode)) return;
    setCapabilityNotice(null);
    if (mode !== 'asset') setAssetSource(null);
    setProviderId('auto');
    session.setMode(mode);
  };

  const remoteGenerationControls = (
    <div className="build-remote-controls">
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
      <label className="build-provider-field">Provider <span>可选 · 默认自动路由</span>
        <select value={providerId} disabled={running || !caps.paired} onChange={(event) => setProviderId(event.target.value)}>
          <option value="auto">Auto · Recommended</option>
          {providerOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label} · {provider.id}</option>
          ))}
        </select>
        {providerOptions.length > 1 ? <small className="build-provider-hint">切换 Provider 后再次 Generate；结果会按 Provider 保留在 Recent Outputs，便于对比。</small> : null}
      </label>
      {state.mode === 'asset' ? (
        <>
          {assetSource ? (
            <div className="build-source-artifact">
              <div>
                <small>IMAGE SOURCE</small>
                <strong>{assetSource.prompt || 'Image'}</strong>
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
    </div>
  );

  return (
    <section className="build-workbench" aria-label="Build Workbench">
      <header className="build-heading">
        <div>
          <div className="eyebrow">BUILD</div>
          <h1>Build Workbench</h1>
          <p>在当前世界中生成 Image、3D Asset 或完整 World。</p>
        </div>
        <button id="build-open-advanced" className="build-advanced-button" type="button" onClick={() => root.classList.add('build-advanced-open')}>{running ? 'Jobs / Cancel' : 'Advanced'}</button>
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
          {state.mode === 'image' ? (
            <>
              <section className="build-local-image-intake" aria-label="本地图片准备">
                <div className="build-local-image-heading">
                  <div><strong>选择本地图片</strong><span>先在本机确认，再进入 3D 生成。</span></div>
                  <label className="build-local-image-file">
                    {localImageDraft ? '重新选择' : '选择图片'}
                    <input
                      id="build-local-image-file"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={localImageBusy || running}
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        event.currentTarget.value = '';
                        void selectLocalImage(file);
                      }}
                    />
                  </label>
                </div>
                {localImageDraft ? (
                  <div className="build-local-image-review">
                    <div className="build-local-image-meta">
                      <strong>{localImageDraft.name}</strong>
                      <span>{localImageDraft.width} × {localImageDraft.height} · Source PNG · {(localImageDraft.bytes.byteLength / 1024 / 1024).toFixed(2)} MiB</span>
                      <small>Crop 与 Alpha Mask 全部只在浏览器本地处理；确认前不会发送到 Connector 或远程生成服务。</small>
                    </div>
                    <LocalImageEditor
                      ref={localImageEditorRef}
                      sourceUrl={localImageDraft.url}
                      sourceWidth={localImageDraft.width}
                      sourceHeight={localImageDraft.height}
                      disabled={localImageBusy || running}
                    />
                    <div className="build-local-image-actions">
                      {!caps.paired ? (
                        <button type="button" className="build-connect" disabled={connecting} onClick={() => void connect()}>
                          {pairingId ? '继续配对' : connecting ? '连接中…' : '连接本机 Connector'}
                        </button>
                      ) : null}
                      <button
                        id="build-local-image-approve"
                        type="button"
                        className="build-generate"
                        disabled={localImageBusy || running || !caps.paired}
                        onClick={() => void approveLocalImage()}
                      >
                        {localImageBusy ? '处理中…' : '确认最终 RGBA'}
                      </button>
                      <button type="button" disabled={localImageBusy || running} onClick={clearLocalImage}>清除</button>
                    </div>
                  </div>
                ) : (
                  <div className="build-local-image-empty">
                    <strong>还没有选择图片</strong>
                    <span>支持 PNG / JPEG / WebP；选择后先本地转为 PNG 并预览。</span>
                  </div>
                )}
                {localImageError ? <div className="build-error">{localImageError}</div> : null}
              </section>
              <details className="build-cloud-image-options">
                <summary>可选：从文字生成图片</summary>
                <p>需要外部生成计算资源。适合没有现成参考图时使用。</p>
                {remoteGenerationControls}
              </details>
              <div id="build-capability-state" className="build-capability-state build-local-image-state">
                {capabilityNotice || (caps.paired ? '本机 Connector 已就绪；选择图片并确认即可。' : '可先选图预览；确认时再连接本机 Connector。')}
              </div>
            </>
          ) : remoteGenerationControls}
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
            <div className="build-section-heading"><span>Current Result</span><small>READY</small></div>
            {state.result.kind === 'image' ? (
              <ImageResultView world={world} result={state.result} onGenerate3D={prepare3DFromImage} />
            ) : state.result.kind === 'asset' ? (
              <AssetResultView world={world} controller={controller} result={state.result} log={log} />
            ) : (
              <WorldResultView world={world} controller={controller} result={state.result} log={log} />
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
