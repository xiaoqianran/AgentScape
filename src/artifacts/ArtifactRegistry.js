import {
  ARTIFACT_LEASE_HOLDER_KINDS,
  ArtifactContractError,
  artifactImmutableSignature,
  normalizeArtifactDescriptor,
  normalizeArtifactHash,
  normalizeArtifactLocation,
  requireSafeArtifactId
} from './ArtifactDescriptor.js';

const HOLDER_KIND_SET=new Set(ARTIFACT_LEASE_HOLDER_KINDS);
const SAFE_REASON=/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,199}$/;
const SAFE_CODE=/^[A-Z0-9][A-Z0-9._:-]{0,119}$/i;
const UNSAFE_REASON_RE=/https?:\/\/|Bearer\s+/i;
const clone=(value)=>value == null ? value : structuredClone(value);

function normalizeTime(value,field,{required=false}={}) {
  if (value==null||value==='') {
    if (required) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID',`Artifact lease requires ${field}`,{field});
    return null;
  }
  const time=Date.parse(String(value));
  if (!Number.isFinite(time)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID',`Artifact lease has invalid ${field}`,{field});
  return new Date(time).toISOString();
}

function normalizeLease(value={},artifactId) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease must be an object');
  const holder=value.holder;
  if (!holder || typeof holder!=='object' || Array.isArray(holder)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease requires holder');
  const holderKind=String(holder.kind||'');
  if (!HOLDER_KIND_SET.has(holderKind)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID',`Unsupported artifact lease holder kind: ${holderKind}`);
  const reason=String(value.reason||'').trim();
  if (!SAFE_REASON.test(reason) || UNSAFE_REASON_RE.test(reason)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease reason is invalid');
  const createdAt=normalizeTime(value.createdAt,'createdAt',{required:true});
  const expiresAt=normalizeTime(value.expiresAt,'expiresAt');
  if (expiresAt && Date.parse(expiresAt)<=Date.parse(createdAt)) throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease expiry must be after creation');
  return {
    id:requireSafeArtifactId(value.id,'lease.id'),
    artifactId,
    locationId:value.locationId==null?null:requireSafeArtifactId(value.locationId,'lease.locationId'),
    holder:{kind:holderKind,id:requireSafeArtifactId(holder.id,'lease.holder.id')},
    reason,
    createdAt,
    expiresAt
  };
}

export class ArtifactRegistry {
  #now;
  #artifacts=new Map();
  #hashIndex=new Map();
  #leases=new Map();

  constructor({now=()=>Date.now()}={}) {
    this.#now=now;
  }

  register(payload) {
    const descriptor=normalizeArtifactDescriptor(payload);
    const previous=this.#artifacts.get(descriptor.id);
    if (previous) {
      if (artifactImmutableSignature(previous)!==artifactImmutableSignature(descriptor)) {
        throw new ArtifactContractError('ARTIFACT_IDENTITY_CONFLICT','Artifact ID already exists with different immutable identity',{id:descriptor.id});
      }
      return this.get(descriptor.id);
    }
    this.#artifacts.set(descriptor.id,descriptor);
    if (!this.#hashIndex.has(descriptor.hash)) this.#hashIndex.set(descriptor.hash,new Set());
    this.#hashIndex.get(descriptor.hash).add(descriptor.id);
    return this.get(descriptor.id);
  }

  has(id) { return this.#artifacts.has(id); }

  get(id) {
    const artifact=this.#artifacts.get(id);
    return artifact?clone(artifact):null;
  }

  list() {
    return [...this.#artifacts.values()].map(clone).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
  }

  findByHash(hash) {
    const canonical=normalizeArtifactHash(hash);
    return [...(this.#hashIndex.get(canonical)||[])].sort();
  }

  updateLocation(id,locationPayload) {
    const artifactId=requireSafeArtifactId(id);
    const artifact=this.#artifacts.get(artifactId);
    if (!artifact) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id:artifactId});
    const location=normalizeArtifactLocation(locationPayload,artifactId);
    const next=clone(artifact);
    const index=next.locations.findIndex((item)=>item.id===location.id);
    if (index===-1) {
      next.locations.push(location);
    } else {
      const previous=next.locations[index];
      const accessConflict=previous.access && location.access && JSON.stringify(previous.access)!==JSON.stringify(location.access);
      if (previous.kind!==location.kind || previous.scope!==location.scope || accessConflict) {
        throw new ArtifactContractError('ARTIFACT_LOCATION_IDENTITY_CONFLICT','Artifact location ID cannot change kind, scope, or active access identity',{
          id:artifactId,locationId:location.id
        });
      }
      next.locations[index]=location;
    }
    this.#artifacts.set(artifactId,next);
    return this.get(artifactId);
  }

  removeLocation(id,locationId) {
    const artifactId=requireSafeArtifactId(id);
    const locationKey=requireSafeArtifactId(locationId,'locationId');
    const artifact=this.#artifacts.get(artifactId);
    if (!artifact) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id:artifactId});
    if (!artifact.locations.some((item)=>item.id===locationKey)) return {removed:false,artifact:this.get(artifactId)};
    if (this.isLeased(artifactId,{locationId:locationKey})) {
      throw new ArtifactContractError('ARTIFACT_LOCATION_LEASED','Artifact location is protected by an active lease',{id:artifactId,locationId:locationKey});
    }
    const next=clone(artifact);
    next.locations=next.locations.filter((item)=>item.id!==locationKey);
    this.#artifacts.set(artifactId,next);
    return {removed:true,artifact:this.get(artifactId)};
  }

  verifyIntegrity(id,evidence={}) {
    const artifactId=requireSafeArtifactId(id);
    const artifact=this.#artifacts.get(artifactId);
    if (!artifact) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id:artifactId});
    const hash=normalizeArtifactHash(evidence.hash,'integrity.hash');
    const bytes=Number(evidence.bytes);
    if (!Number.isSafeInteger(bytes)||bytes<0) throw new ArtifactContractError('ARTIFACT_INTEGRITY_INVALID','Integrity evidence bytes are invalid');
    const mime=String(evidence.mime||'').trim().toLowerCase();
    if (hash!==artifact.hash||bytes!==artifact.bytes||mime!==artifact.mime) {
      throw new ArtifactContractError('ARTIFACT_INTEGRITY_MISMATCH','Integrity evidence does not match the declared descriptor',{id:artifactId});
    }
    const verifiedAt=normalizeTime(evidence.verifiedAt,'verifiedAt',{required:true});
    const method=String(evidence.method||'').trim();
    if (!method || !SAFE_CODE.test(method)) throw new ArtifactContractError('ARTIFACT_INTEGRITY_INVALID','Integrity verification method must be a stable safe identifier');
    const next=clone(artifact);
    next.integrity={state:'verified',verifiedAt,method,rejection:null};
    this.#artifacts.set(artifactId,next);
    return this.get(artifactId);
  }

  rejectIntegrity(id,evidence={}) {
    const artifactId=requireSafeArtifactId(id);
    const artifact=this.#artifacts.get(artifactId);
    if (!artifact) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id:artifactId});
    const code=String(evidence.code||'').trim();
    if (!code || !SAFE_CODE.test(code)) throw new ArtifactContractError('ARTIFACT_INTEGRITY_INVALID','Integrity rejection code must be a stable safe identifier');
    const checkedAt=normalizeTime(evidence.checkedAt,'checkedAt',{required:true});
    const next=clone(artifact);
    next.integrity={state:'rejected',verifiedAt:null,method:null,rejection:{code,checkedAt}};
    this.#artifacts.set(artifactId,next);
    return this.get(artifactId);
  }

  acquireLease(artifactId,leasePayload) {
    const id=requireSafeArtifactId(artifactId);
    const artifact=this.#artifacts.get(id);
    if (!artifact) throw new ArtifactContractError('ARTIFACT_NOT_FOUND','Artifact does not exist',{id});
    const lease=normalizeLease(leasePayload,id);
    if (lease.expiresAt && Date.parse(lease.expiresAt)<=this.#now()) {
      throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease is already expired',{leaseId:lease.id});
    }
    if (lease.locationId && !artifact.locations.some((location)=>location.id===lease.locationId)) {
      throw new ArtifactContractError('ARTIFACT_LEASE_INVALID','Artifact lease references an unknown location',{id,locationId:lease.locationId});
    }
    const previous=this.#leases.get(lease.id);
    if (previous && JSON.stringify(previous)!==JSON.stringify(lease)) throw new ArtifactContractError('ARTIFACT_LEASE_CONFLICT','Artifact lease ID already exists with different semantics',{leaseId:lease.id});
    this.#leases.set(lease.id,lease);
    return clone(lease);
  }

  releaseLease(leaseId) {
    const id=requireSafeArtifactId(leaseId,'leaseId');
    return this.#leases.delete(id);
  }

  leasesFor(artifactId,{includeExpired=false}={}) {
    const id=requireSafeArtifactId(artifactId);
    const now=this.#now();
    return [...this.#leases.values()]
      .filter((lease)=>lease.artifactId===id && (includeExpired || !lease.expiresAt || Date.parse(lease.expiresAt)>now))
      .map(clone)
      .sort((a,b)=>a.id.localeCompare(b.id));
  }

  isLeased(artifactId,{locationId=null}={}) {
    const id=requireSafeArtifactId(artifactId);
    const location=locationId==null?null:requireSafeArtifactId(locationId,'locationId');
    return this.leasesFor(id).some((lease)=>lease.locationId==null || location==null || lease.locationId===location);
  }
}
