import { GenerationJobCenterView } from '../generation/GenerationJobCenterView';

export function PersistentGenerationHost({
  active,
  close
}: {
  active:boolean;
  close:()=>void;
}) {
  return (
    <section
      className={'persistent-generation-host' + (active ? ' is-active' : '')}
      aria-hidden={!active}
    >
      <div className="product-page product-advanced-page">
        <div className="product-page-toolbar">
          <button id="build-close-advanced" type="button" onClick={close}>← 返回 Build</button>
          <span>Advanced Generation Console</span>
        </div>
        <GenerationJobCenterView />
      </div>
    </section>
  );
}
