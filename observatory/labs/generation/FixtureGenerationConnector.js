import { Document, Primitive, WebIO } from "@gltf-transform/core";
import { IncrementalSha256 } from "../../../generation/artifacts/IncrementalSha256.js";

export const FIXTURE_PROVIDER_ID = "observatory-fixture";
export const FIXTURE_OPERATION = "observatory-fixture.asset.text_to_3d.v1";
export const FIXTURE_ASSET_ID = "generated_red_apple";
export const FIXTURE_INSTANCE_ID = "generated_apple_01";
export const FIXTURE_ARTIFACT_ID = "artifact_obs_red_apple";

const clone = (value) => value == null ? value : structuredClone(value);
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => clone(payload)
});

function hashBytes(bytes) {
  const hasher = new IncrementalSha256();
  hasher.update(bytes);
  return hasher.digestArtifactHash();
}

async function buildRedAppleGlb() {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const positions = [
    0, 0.36, 0,
    0, -0.30, 0,
    0.25, 0, 0,
    -0.25, 0, 0,
    0, 0, 0.25,
    0, 0, -0.25
  ];
  const indices = [
    0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2,
    1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5
  ];
  const position = document.createAccessor("POSITION")
    .setType("VEC3")
    .setBuffer(buffer)
    .setArray(new Float32Array(positions));
  const index = document.createAccessor("indices")
    .setType("SCALAR")
    .setBuffer(buffer)
    .setArray(new Uint16Array(indices));
  const material = document.createMaterial("RedApple")
    .setBaseColorFactor([0.82, 0.06, 0.04, 1])
    .setRoughnessFactor(0.55)
    .setMetallicFactor(0);
  const primitive = document.createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setAttribute("POSITION", position)
    .setIndices(index)
    .setMaterial(material);
  const mesh = document.createMesh("RedApple").addPrimitive(primitive);
  const node = document.createNode("RedApple").setMesh(mesh);
  const scene = document.createScene("Scene").addChild(node);
  document.getRoot().setDefaultScene(scene);
  return new Uint8Array(await new WebIO().writeBinary(document));
}

export class FixtureGenerationConnector {
  static async create() {
    const bytes = await buildRedAppleGlb();
    return new FixtureGenerationConnector({ bytes });
  }

  constructor({ bytes }) {
    this.bytes = new Uint8Array(bytes);
    this.hash = hashBytes(this.bytes);
    this.jobs = new Map();
    this.requests = [];
    this.jobSequence = 0;
    this.capabilityRevision = "obs-fixture-cap-v1";
    this.capabilityHash = "sha256:observatory-fixture-capability-v1";
    this.connector = { id: "observatory-fixture", instance: "local-deterministic", version: "1.0.0" };
  }

  isPaired() { return true; }

  session() {
    return {
      status: "paired",
      connector: clone(this.connector),
      contractVersion: "1",
      clientIdentity: "agentscape-observatory",
      scopes: ["capabilities.read", "jobs.submit", "jobs.read", "jobs.cancel", "artifacts.read"],
      issuedAt: iso(-60_000),
      expiresAt: iso(86_400_000),
      capabilityRevision: this.capabilityRevision,
      capabilityHash: this.capabilityHash
    };
  }

  capabilityPayload() {
    return {
      contractVersion: "1",
      connector: clone(this.connector),
      revision: this.capabilityRevision,
      hash: this.capabilityHash,
      generatedAt: iso(-1_000),
      expiresAt: iso(86_400_000),
      providers: [{
        id: FIXTURE_PROVIDER_ID,
        displayName: "Observatory Deterministic 3D Fixture",
        version: "1",
        contractVersion: "1",
        status: "available",
        health: "healthy",
        capabilities: [{
          operation: FIXTURE_OPERATION,
          version: "1",
          displayName: "Deterministic text to red apple GLB",
          category: "asset-generation",
          status: "available",
          input: {
            types: ["text"],
            schema: {
              type: "object",
              required: ["prompt"],
              properties: { prompt: { type: "string" } }
            }
          },
          output: { roles: ["primary-glb"], required: ["primary-glb"], optional: [] },
          profiles: { deterministic: { label: "Deterministic" } },
          execution: { async: true, stages: ["generate", "artifact"], durationClass: "instant", costClass: "free-fixture" },
          prerequisites: { authMode: "connector-session", connection: true },
          support: { cancel: true, resume: true, idempotency: true },
          artifactTransport: "connector-artifact"
        }]
      }]
    };
  }

  async request(path, options = {}) {
    this.requests.push({ path, scope: options.scope || null, method: options.method || "GET" });
    if (path === "/connector/v1/capabilities") return jsonResponse(this.capabilityPayload());

    if (path === "/connector/v1/jobs" && (options.method || "GET") === "POST") {
      const body = JSON.parse(options.body || "{}");
      const id = `obs_job_${String(++this.jobSequence).padStart(2, "0")}`;
      const now = iso();
      const job = {
        id,
        provider: body.provider,
        operation: body.operation,
        kind: "generation",
        requestHash: body.requestHash,
        idempotencyKey: body.idempotencyKey,
        contractVersion: body.contractVersion,
        capabilityHash: body.capabilityHash,
        capabilityRevision: body.capabilityRevision,
        status: "succeeded",
        stage: "artifact-ready",
        progress: { kind: "steps", current: 1, total: 1, unit: "stage", label: "fixture complete" },
        attempt: 1,
        relations: [],
        effectiveOptions: { profile: body.profile || "deterministic" },
        model: { id: "observatory-red-apple", version: "1", revision: "fixture" },
        workflow: { id: "text-to-3d-fixture", version: "1", revision: "fixture" },
        createdAt: now,
        submittedAt: now,
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        eventSequence: 1,
        result: {
          manifestId: null,
          artifacts: [{
            id: FIXTURE_ARTIFACT_ID,
            role: "primary-glb",
            mime: "model/gltf-binary",
            bytes: this.bytes.byteLength,
            hash: this.hash
          }]
        }
      };
      this.jobs.set(id, job);
      return jsonResponse({ job });
    }

    if (path === "/connector/v1/jobs") {
      return jsonResponse({ jobs: [...this.jobs.values()].map(clone), eventCursor: this.jobs.size });
    }

    const cancelMatch = path.match(/^\/connector\/v1\/jobs\/([A-Za-z0-9_-]+)\/cancel$/);
    if (cancelMatch) {
      const job = this.jobs.get(cancelMatch[1]);
      if (!job) return jsonResponse({ code: "JOB_NOT_FOUND", message: "Fixture job not found" }, 404);
      return jsonResponse({ job });
    }

    const jobMatch = path.match(/^\/connector\/v1\/jobs\/([A-Za-z0-9_-]+)$/);
    if (jobMatch) {
      const job = this.jobs.get(jobMatch[1]);
      return job ? jsonResponse({ job }) : jsonResponse({ code: "JOB_NOT_FOUND", message: "Fixture job not found" }, 404);
    }

    if (path === `/connector/v1/artifacts/${FIXTURE_ARTIFACT_ID}`) {
      return new Response(this.bytes, {
        status: 200,
        headers: {
          "content-type": "model/gltf-binary",
          "content-length": String(this.bytes.byteLength)
        }
      });
    }

    return jsonResponse({ code: "FIXTURE_ROUTE_NOT_FOUND", message: `Unknown fixture route: ${path}` }, 404);
  }
}
