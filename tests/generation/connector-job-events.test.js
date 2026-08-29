import { describe, expect, it, vi } from 'vitest';
import {
  ConnectorJobEventClient,
  normalizeConnectorJobEvent,
  parseConnectorJobEventText
} from '../../generation/connector/ConnectorJobEventClient.js';

const event=(sequence=1,overrides={})=>({
  sequence,
  timestamp:'2026-08-24T07:10:00.000Z',
  jobId:'job_01',
  attempt:1,
  type:'job.updated',
  oldStatus:'queued',
  newStatus:'running',
  stage:'reconstructing',
  progress:{kind:'items',current:2,total:5,unit:'views'},
  message:'job advanced',
  details:{worker:'gpu'},
  correlationId:'corr:job_01',
  ...overrides
});

describe('Connector Job event stream contract',()=>{
  it('normalizes a safe append-only event envelope',()=>{
    expect(normalizeConnectorJobEvent(event(7),{sseId:'7'})).toEqual({
      sequence:7,
      timestamp:'2026-08-24T07:10:00.000Z',
      jobId:'job_01',attempt:1,type:'job.updated',
      oldStatus:'queued',newStatus:'running',stage:'reconstructing',
      progress:{kind:'items',current:2,total:5,unit:'views'},
      message:'job advanced',details:{worker:'gpu'},correlationId:'corr:job_01'
    });
  });

  it('rejects SSE sequence mismatch and unsafe log/event details',()=>{
    expect(()=>normalizeConnectorJobEvent(event(7),{sseId:'8'}))
      .toThrow(expect.objectContaining({code:'CONNECTOR_JOB_EVENT_CONFLICT'}));
    expect(()=>normalizeConnectorJobEvent(event(7,{details:{signedUrl:'https://signed.example/x'}})))
      .toThrow(expect.objectContaining({code:'CONNECTOR_JOB_EVENT_UNSAFE'}));
    expect(()=>normalizeConnectorJobEvent(event(7,{details:{note:'https://signed.example/x'}})))
      .toThrow(expect.objectContaining({code:'CONNECTOR_JOB_EVENT_UNSAFE'}));
    expect(()=>normalizeConnectorJobEvent(event(7,{message:'Bearer should-never-log'})))
      .toThrow(expect.objectContaining({code:'CONNECTOR_JOB_EVENT_UNSAFE'}));
    expect(()=>normalizeConnectorJobEvent(event(7,{details:{traceback:'provider traceback'}})))
      .toThrow(expect.objectContaining({code:'CONNECTOR_JOB_EVENT_UNSAFE'}));
  });

  it('parses multiple SSE records including comments and multi-line data',()=>{
    const text=[
      ': keepalive',
      'id: 1',
      `data: ${JSON.stringify(event(1))}`,
      '',
      'id: 2',
      `data: ${JSON.stringify(event(2,{oldStatus:'running',newStatus:'succeeded',type:'job.finished'}))}`,
      ''
    ].join('\n');
    const events=parseConnectorJobEventText(text);
    expect(events.map((item)=>item.sequence)).toEqual([1,2]);
    expect(events[1].newStatus).toBe('succeeded');
  });

  it('opens the SSE resource with jobs.read and Last-Event-ID',async()=>{
    const response={ok:true,status:200,body:{getReader(){}}};
    const connectorClient={request:vi.fn(async()=>response)};
    const client=new ConnectorJobEventClient({connectorClient});
    await expect(client.open({lastSequence:41})).resolves.toBe(response);
    expect(connectorClient.request).toHaveBeenCalledWith('/connector/v1/events',{
      scope:'jobs.read',headers:{accept:'text/event-stream','Last-Event-ID':'41'}
    });
  });

  it('streams chunked SSE events without requiring an infinite internal poll loop',async()=>{
    const encoder=new TextEncoder();
    const payload=`id: 9\ndata: ${JSON.stringify(event(9))}\n\n`;
    const body=new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0,25)));
        controller.enqueue(encoder.encode(payload.slice(25)));
        controller.close();
      }
    });
    const connectorClient={request:vi.fn(async()=>({ok:true,status:200,body}))};
    const client=new ConnectorJobEventClient({connectorClient});
    const received=[];
    for await (const item of client.events({lastSequence:8})) received.push(item);
    expect(received).toHaveLength(1);
    expect(received[0].sequence).toBe(9);
  });

  it('maps a broken event stream to recoverable connection_required',async()=>{
    const body={getReader:()=>({
      read:async()=>{ throw new Error('socket reset'); },
      releaseLock(){}
    })};
    const connectorClient={request:vi.fn(async()=>({ok:true,status:200,body}))};
    const client=new ConnectorJobEventClient({connectorClient});
    const iterator=client.events()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({code:'CONNECTION_REQUIRED',details:{recoverable:true}});
  });
});
