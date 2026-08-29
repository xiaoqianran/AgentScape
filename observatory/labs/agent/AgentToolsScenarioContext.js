import * as THREE from "three";
import { AgentTools } from "../../../agent/AgentTools.js";
import { SkillRegistry } from "../../../agent/skills/SkillRegistry.js";
import { registerSpatialSkills } from "../../../agent/skills/packs/spatialSkills.js";
import { registerSceneSkills } from "../../../agent/skills/packs/sceneSkills.js";
import { registerInteractionSkills } from "../../../agent/skills/packs/interactionSkills.js";
import { InteractionScenarioContext } from "../interaction/InteractionScenarioContext.js";

export class AgentToolsScenarioContext {
  constructor({ scene }) {
    this.scene = scene;
    this.world = new InteractionScenarioContext({ scene });
    this.toolCalls = [];
    this.lastTool = null;
  }

  async init() {
    await this.world.init();
    const runtime = {
      spatial: this.world.spatial,
      interactions: this.world.interaction,
      navigation: null,
      locomotion: null,
      events: this.world.events,
      trace: null,
      currentWorldRevision: null,
      listObjects: () => this.world.store.list().map(([id, record]) => ({
        id,
        asset: record.assetId,
        position: record.object.position.toArray().map((value) => Number(value.toFixed(2))),
        actions: [...record.manifest.actions]
      }))
    };
    const registry = new SkillRegistry({ runtime });
    const add = (name, options, handler) => registry.register({ name, ...options, handler });
    registerSceneSkills(add, runtime);
    registerSpatialSkills(add, runtime);
    registerInteractionSkills(add, runtime);
    runtime.skills = registry;
    this.runtime = runtime;
    this.registry = registry;
    this.tools = new AgentTools(runtime, { profile: "builder", actor: "agent" });
    this.world.events.on("tool.called", (event) => this.toolCalls.push(structuredClone(event)));
    return this;
  }

  async call(name, args = {}) {
    const started = performance.now();
    try {
      const result = await this.tools.call(name, args);
      const policy = this.tools.executionPolicy(name, result);
      this.lastTool = { name, args: structuredClone(args), result: structuredClone(result), policy, elapsedMs: performance.now() - started };
      return result;
    } catch (error) {
      this.lastTool = { name, args: structuredClone(args), error: { message: error.message, code: error.code || null }, elapsedMs: performance.now() - started };
      throw error;
    }
  }

  async createHeldAgentCup() {
    await this.world.addAsset({ id: "agent", assetId: "agent", position: [0, 0, 0] });
    await this.world.addAsset({ id: "cup", assetId: "cup", position: [0, 0, 0] });
    this.world.store.get("cup").state.heldBy = { kind: "agent", id: "agent" };
    this.world.interaction.rebuildHeldOwnership();
    this.world.advance(2);
  }

  async callAndDriveSettle(name, args = {}, { maxFrames = 360 } = {}) {
    let settled = false;
    let value;
    let failure;
    const promise = this.call(name, args).then((result) => { settled = true; value = result; }).catch((error) => { settled = true; failure = error; });
    for (let frame = 0; frame < maxFrames && !settled; frame += 1) {
      this.world.advance(1);
      await Promise.resolve();
    }
    await promise;
    if (failure) throw failure;
    return value;
  }

  debugSnapshot() {
    return {
      schemaVersion: 1,
      source: "agent-tools",
      definitions: this.tools.definitions(),
      lastTool: this.lastTool ? structuredClone(this.lastTool) : null,
      toolCalls: this.toolCalls.map((call) => structuredClone(call)),
      interaction: this.world.interaction.debugSnapshot(),
      physics: this.world.physics.debugSnapshot({ nativeGeometry: false, contacts: true }),
      spatial: this.world.spatial.debugSnapshot()
    };
  }

  inspect() {
    const snapshot = this.debugSnapshot();
    return {
      title: "AgentTools",
      kind: "AgentTools → SkillRegistry → domain skill pack → Runtime",
      values: {
        definitions: snapshot.definitions.length,
        lastTool: snapshot.lastTool?.name || null,
        outcome: snapshot.lastTool?.policy?.outcome || null,
        elapsedMs: snapshot.lastTool?.elapsedMs ? Number(snapshot.lastTool.elapsedMs.toFixed(3)) : null,
        toolCalledEvents: snapshot.toolCalls.length,
        humanHeld: snapshot.interaction.held.human,
        agentHeld: snapshot.interaction.held.agents
      }
    };
  }

  dispose() { this.world.dispose(); }
}
