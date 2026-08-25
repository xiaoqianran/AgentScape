import { describe, expect, it } from 'vitest';
import { PhysicsBackend } from '../src/runtime/physics/PhysicsBackend.js';
import { RapierPhysicsBackend } from '../src/runtime/physics/RapierPhysicsBackend.js';

describe('PhysicsBackend contract',()=>{
  it('declares the minimum backend boundary without exposing a concrete solver contract',()=>{
    const backend=new PhysicsBackend('test',['rigid-body']);
    expect(backend.identity).toBe('test'); expect(backend.hasCapability('rigid-body')).toBe(true); expect(backend.hasCapability('soft-body')).toBe(false); expect(backend.supportsExecutionMode('realtime')).toBe(true);
    expect(()=>backend.createWorld()).toThrow(/must be implemented/);
  });
  it('Rapier backend satisfies capability and lifecycle parity',async()=>{
    const backend=new RapierPhysicsBackend(); await backend.init(); const world=backend.createWorld();
    expect(backend.identity).toBe('rapier'); expect(backend.hasCapability('rigid-body')).toBe(true); expect(backend.hasCapability('articulated-body')).toBe(true); expect(backend.hasCapability('character-controller')).toBe(true); expect(backend.supportsExecutionMode('validation-only')).toBe(true); expect(backend.qualities).toEqual({realtime:true,deterministic:true});
    expect(world).toBeTruthy(); backend.step(world,1/60); backend.dispose(world);
  });
});
