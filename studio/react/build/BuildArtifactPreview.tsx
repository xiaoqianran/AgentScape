import { useEffect, useMemo, useRef, useState } from 'react';

type ArtifactDescriptor = {
  id?: string;
  mime?: string;
  role?: string;
  locations?: Array<{ kind?: string; state?: string; access?: { kind?: string; key?: string } }>;
};

type PreviewWorld = {
  generation?: {
    artifacts?: {
      registry?: { get?: (id: string) => ArtifactDescriptor | null };
      byteStore?: { get?: (key: string) => { data?: Uint8Array | ArrayBuffer } | null };
    };
  };
};

function localArtifact(world: PreviewWorld, artifactId: string) {
  const descriptor = world.generation?.artifacts?.registry?.get?.(artifactId) || null;
  const location = descriptor?.locations?.find?.((item) =>
    item.kind === 'local-cache' && item.state === 'available' && item.access?.kind === 'cache-key'
  );
  if (!descriptor || !location?.access?.key) return { descriptor, data:null };
  return { descriptor, data:world.generation?.artifacts?.byteStore?.get?.(location.access.key)?.data || null };
}

function ImageArtifactPreview({ world, artifactId, label }: { world: PreviewWorld; artifactId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const local = localArtifact(world, artifactId);
    if (!local.data) { setUrl(null); return; }
    const next = URL.createObjectURL(new Blob([local.data as BlobPart], { type:local.descriptor?.mime || 'image/png' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [artifactId, world]);
  return url ? <div className="build-artifact-image"><img src={url} alt={label} /></div> : null;
}

export function ModelArtifactPreview({ world, artifactId, label }: { world: PreviewWorld; artifactId: string | null | undefined; label: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !artifactId) { setState('unavailable'); return; }
    const local = localArtifact(world, artifactId);
    if (!local.data) { setState('unavailable'); return; }

    let disposed = false;
    let disposePreview: (() => void) | null = null;
    const url = URL.createObjectURL(new Blob([local.data as BlobPart], { type:'model/gltf-binary' }));
    host.replaceChildren();
    setState('loading');

    void import('./createModelPreview.js').then(({ mountModelPreview }) =>
      (mountModelPreview as any)({ host, url, onReady:() => { if (!disposed) setState('ready'); } })
    ).then((dispose) => {
      if (disposed) dispose?.();
      else disposePreview = dispose || null;
    }).catch(() => {
      if (!disposed) setState('error');
    });

    return () => {
      disposed = true;
      disposePreview?.();
      host.replaceChildren();
      URL.revokeObjectURL(url);
    };
  }, [artifactId, world]);

  return (
    <div className="build-model-preview" data-state={state} aria-label={label}>
      <div ref={hostRef} className="build-model-preview-canvas" />
      {state !== 'ready' ? <div className="build-preview-state">{state === 'loading' ? 'Loading 3D preview…' : state === 'error' ? '3D preview unavailable' : 'GLB preview not cached locally'}</div> : null}
      {state === 'ready' ? <div className="build-preview-hint">Drag to orbit · wheel to zoom</div> : null}
    </div>
  );
}

export function WorldArtifactPreview({
  world,
  artifacts,
  label
}: {
  world: PreviewWorld;
  artifacts: Record<string, string | null> | undefined;
  label: string;
}) {
  const entries = useMemo(() => Object.entries(artifacts || {}).filter((entry): entry is [string, string] => Boolean(entry[1])), [artifacts]);
  const resolved = entries.map(([role, id]) => ({ role, id, descriptor:localArtifact(world, id).descriptor }));
  const image = resolved.find((item) => String(item.descriptor?.mime || '').startsWith('image/'));
  const glb = resolved.find((item) => item.descriptor?.mime === 'model/gltf-binary');

  return (
    <div className="build-world-preview">
      {image ? <ImageArtifactPreview world={world} artifactId={image.id} label={label} /> : glb ? <ModelArtifactPreview world={world} artifactId={glb.id} label={label} /> : (
        <div className="build-world-preview-placeholder"><span>WORLD</span><strong>{entries.length} artifacts</strong><small>Open the bundle to render the complete environment.</small></div>
      )}
      <div className="build-world-role-list">
        {entries.slice(0, 8).map(([role]) => <span key={role}>{role}</span>)}
      </div>
    </div>
  );
}
