import { GenerationJobContractError, requireSafeJobId } from './GenerationJobProjection.js';

const clone=(value)=>value == null ? value : structuredClone(value);

function safeTransportMessage(value) {
  const text=String(value || 'Connector is not reachable').trim();
  if (!text || text.length > 240 || /https?:\/\/|Bearer\s+/i.test(text)) return 'Connector is not reachable';
  return text;
}

export class GenerationJobTransportOverlay {
  constructor({ now=()=>Date.now() }={}) {
    this.now=now;
    this.blocks=new Map();
  }

  markConnectionRequired(id,{code='CONNECTION_REQUIRED',message='Connector is not reachable'}={}) {
    const jobId=requireSafeJobId(id);
    const block={
      state:'connection_required',
      code:String(code || 'CONNECTION_REQUIRED'),
      message:safeTransportMessage(message),
      since:new Date(this.now()).toISOString()
    };
    this.blocks.set(jobId,block);
    return clone(block);
  }

  clear(id) {
    const jobId=requireSafeJobId(id);
    return this.blocks.delete(jobId);
  }

  get(id) {
    const jobId=requireSafeJobId(id);
    return clone(this.blocks.get(jobId) || null);
  }

  clearAll() { this.blocks.clear(); }

  view(job) {
    if (!job?.id) throw new GenerationJobContractError('JOB_VIEW_INVALID','Job transport view requires a canonical Job');
    const transport=this.get(job.id);
    return {
      job:clone(job),
      transport,
      effectivePhase:transport?.state === 'connection_required' ? 'recoverable' : job.phase
    };
  }
}
