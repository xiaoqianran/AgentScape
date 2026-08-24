import { ConnectorContractError } from '../connector/ConnectorSession.js';
import { connectorJobEventSignature, normalizeConnectorJobEvent } from '../connector/ConnectorJobEventClient.js';
import { connectorJobStatusIsRemoteTerminal, requireSafeJobId } from './GenerationJobProjection.js';
import { GenerationJobTransportOverlay } from './GenerationJobTransportOverlay.js';

const ACTIVE_REMOTE_STATUSES=new Set(['accepted','queued','running','connection_required','cancel_requested']);

export class GenerationJobEventCursor {
  constructor(initialSequence=null) {
    this.sequence=null;
    this.signature=null;
    if (initialSequence != null) this.reset(initialSequence);
  }

  classify(event) {
    if (this.sequence == null) return 'next';
    if (event.sequence < this.sequence) return 'stale';
    if (event.sequence === this.sequence) {
      if (!this.signature) return 'stale';
      if (this.signature === connectorJobEventSignature(event)) return 'idempotent';
      throw new ConnectorContractError('CONNECTOR_JOB_EVENT_CONFLICT','Same Connector event sequence contains conflicting envelopes',{sequence:event.sequence});
    }
    return 'next';
  }

  commit(event) {
    this.sequence=event.sequence;
    this.signature=connectorJobEventSignature(event);
    return this.sequence;
  }

  reset(sequence) {
    const n=Number(sequence);
    if (!Number.isSafeInteger(n) || n < 0) throw new ConnectorContractError('CONNECTOR_JOB_EVENT_INVALID','Event cursor must be a non-negative safe integer');
    this.sequence=n;
    this.signature=null;
    return this.sequence;
  }
}

export class GenerationJobReconciler {
  constructor({jobClient,overlay=new GenerationJobTransportOverlay(),cursor=new GenerationJobEventCursor()}={}) {
    if (!jobClient?.list || !jobClient?.get) throw new ConnectorContractError('JOB_RECONCILER_INVALID','GenerationJobReconciler requires ConnectorJobClient');
    this.jobClient=jobClient;
    this.overlay=overlay;
    this.cursor=cursor;
  }

  async bootstrap() {
    try {
      const result=await this.jobClient.list({replaceStore:true});
      this.overlay.clearAll();
      if (result.eventCursor != null) this.cursor.reset(result.eventCursor);
      return {state:'ready',...result};
    } catch (error) {
      if (error?.code === 'CONNECTION_REQUIRED') return {state:'connection_required',jobs:this.jobClient.listCached(),eventCursor:this.cursor.sequence};
      throw error;
    }
  }

  async reconcileJob(id) {
    const jobId=requireSafeJobId(id);
    const before=this.jobClient.getCached(jobId);
    try {
      const job=await this.jobClient.get(jobId);
      this.overlay.clear(jobId);
      return {state:'reconciled',job,view:this.overlay.view(job)};
    } catch (error) {
      if (error?.code === 'CONNECTION_REQUIRED') {
        if (before && !connectorJobStatusIsRemoteTerminal(before.status)) {
          this.overlay.markConnectionRequired(jobId,{code:error.code,message:error.message});
          return {state:'connection_required',job:before,view:this.overlay.view(before)};
        }
      }
      throw error;
    }
  }

  async reconcileActive() {
    const active=this.jobClient.listCached().filter((job)=>ACTIVE_REMOTE_STATUSES.has(job.status));
    const results=[];
    for (const job of active) results.push(await this.reconcileJob(job.id));
    return results;
  }

  async handleEvent(event) {
    const normalizedEvent=normalizeConnectorJobEvent(event);
    const classification=this.cursor.classify(normalizedEvent);
    if (classification !== 'next') return {state:classification,eventCursor:this.cursor.sequence};
    const result=await this.reconcileJob(normalizedEvent.jobId);
    if (result.state !== 'reconciled') return {state:result.state,eventCursor:this.cursor.sequence,job:result.job,view:result.view};
    this.cursor.commit(normalizedEvent);
    return {state:'applied',eventCursor:this.cursor.sequence,job:result.job,view:result.view};
  }
}
