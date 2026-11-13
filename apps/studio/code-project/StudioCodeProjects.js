import { openCodeProject, parseCodeProject } from '../../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { SCENE_LEGACY_SKILLS } from '../../../application/scene/SceneFacade.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { projectTemplate, projectGuide } from './projectTemplate.js';

const fail = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);
const withoutIntegrity = ({ integrity, ...value }) => value;

/** Replace exactly one source fragment; never guess which occurrence an Agent intended. */
function patchSource(source, { oldText, newText } = {}) {
  if (typeof oldText !== 'string' || !oldText.length || typeof newText !== 'string') throw fail('PROJECT_PATCH_INVALID');
  const start = source.indexOf(oldText);
  if (start < 0) throw fail('PROJECT_PATCH_NOT_FOUND');
  if (source.indexOf(oldText, start + 1) >= 0) throw fail('PROJECT_PATCH_AMBIGUOUS');
  if (oldText === newText) throw fail('PROJECT_PATCH_UNCHANGED');
  return source.slice(0, start) + newText + source.slice(start + oldText.length);
}

/** Studio project ownership. Source drafts and live state have distinct revisions. */
export class StudioCodeProjects {
  constructor({ container, baseScene, baseWorld, store = new AuthoringWorldStore({ databaseName:'agentscape-code-projects' }),
    open = openCodeProject, onActivate = () => {}, onShow = () => {} } = {}) {
    Object.assign(this, { container, baseScene, baseWorld, store, open, onActivate, onShow });
    this.session = null; this.draft = null; this.revision = 0; this.runningRevision = null;
    this.listeners = new Set(); this.busy = false; this.visible = false;
    this.current = Object.freeze({ visible:false, active:false, busy:false, project:null, revision:0, runningRevision:null, projects:[], error:null });
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.current;
  get scene() { return this.session?.scene || this.baseScene; }
  get world() { return this.session?.world || this.baseWorld; }
  emit(patch = {}) {
    this.current = Object.freeze({ ...this.current, visible:this.visible, active:Boolean(this.session), busy:this.busy,
      project:this.draft ? clone(this.draft) : null, revision:this.revision, runningRevision:this.runningRevision, ...patch });
    for (const listener of this.listeners) listener();
  }
  show() { this.visible = true; this.onShow(true); this.emit(); void this.refresh().catch(error => this.emit({ error:error.message })); }
  async refresh() { this.emit({ projects:await this.store.list() }); }
  read() { return { ...clone(this.current), guide:projectGuide, starter:projectTemplate, observation:this.session?.scene.observe() || null }; }
  async exclusive(operation) {
    if (this.busy) throw fail('PROJECT_BUSY');
    this.busy = true; this.emit({ error:null });
    try { return await operation(); }
    catch (error) { this.emit({ error:error.message }); throw error; }
    finally { this.busy = false; this.emit(); }
  }
  async persist(project = this.draft, revision = this.revision) {
    await this.store.save({ id:project.id, name:project.name, document:{ project, revision } });
    await this.refresh();
  }
  async write({ project, source, name, expectedRevision, create = false, patch = null } = {}) {
    return this.exclusive(async () => {
      if (!create && (!this.draft || expectedRevision !== this.revision)) throw fail('PROJECT_REVISION_CONFLICT');
      if (create && this.session) throw fail('CLOSE_PROJECT_BEFORE_CREATE');
      if (patch && (create || project || source !== undefined || name !== undefined)) throw fail('PROJECT_PATCH_INVALID');
      const nextSource = patch ? patchSource(this.draft.source, patch) : source;
      const input = project || (create
        ? { schema:'agentscape.code-project', schemaVersion:1, id:'world_' + crypto.randomUUID().replaceAll('-',''), name:name || '我的代码世界', source:source || projectTemplate, resources:{} }
        : { ...withoutIntegrity(this.draft), ...(nextSource !== undefined ? { source:nextSource } : {}), ...(name !== undefined ? { name } : {}) });
      const next = await parseCodeProject(input);
      if (!create && next.id !== this.draft.id) throw fail('PROJECT_ID_CHANGE_REQUIRES_CREATE');
      const revision = this.revision + 1;
      await this.persist(next, revision);
      this.draft = next; this.revision = revision; this.runningRevision = create ? null : this.runningRevision;
      this.visible = true; this.onShow(); this.emit();
      return { status:patch?'project-source-patched':'project-draft-saved', id:next.id, revision };
    });
  }
  /** Atomic unique-substring edit. Revision and persistence share write()'s lock. */
  patch({ oldText, newText, expectedRevision } = {}) {
    return this.write({ expectedRevision, patch:{ oldText, newText } });
  }
  async run({ expectedRevision } = {}) {
    return this.exclusive(async () => {
      if (!this.draft) throw fail('PROJECT_REQUIRED');
      if (expectedRevision !== undefined && expectedRevision !== this.revision) throw fail('PROJECT_REVISION_CONFLICT');
      // Saving acquires the Scene lock; pending actions must settle before replacement.
      const old = this.session;
      const live = old ? (await old.save()).value : null;
      if (!old && this.baseWorld.mutationOwner) throw fail('SCENE_BUSY');
      const project = live && live.id === this.draft.id
        ? { ...withoutIntegrity(this.draft), state:live.state, runtime:live.runtime } : this.draft;
      const next = await this.open({ project, container:this.container, authorized:true });
      try { old?.close(); } catch (error) { next.close(); throw error; }
      this.session = next; this.runningRevision = this.revision;
      this.activeTools = new AgentTools(next.world, { profile:'builder', source:'agent' });
      this.stopFrameError?.();
      this.stopFrameError = next.world.events.on('project.frame.failed', ({ message }) => this.emit({ error:message }));
      this.onActivate(next); this.emit();
      return { status:'project-running', id:project.id, revision:this.revision, observation:next.scene.observe() };
    });
  }
  async save() {
    return this.exclusive(async () => {
      if (!this.session) throw fail('RUN_PROJECT_FIRST');
      if (this.runningRevision !== this.revision) throw fail('RUN_DRAFT_BEFORE_SAVE');
      const result = await this.session.save();
      await this.persist(result.value);
      this.draft = result.value; this.emit();
      return result;
    });
  }
  async load(id) {
    return this.exclusive(async () => {
      if (this.session) throw fail('CLOSE_PROJECT_BEFORE_OPEN');
      const saved = await this.store.load(id);
      if (!saved) throw fail('PROJECT_NOT_FOUND');
      const project = await parseCodeProject(saved.document.project);
      this.draft = project; this.revision = Math.max(this.revision + 1, saved.document.revision); this.runningRevision = null;
      this.visible = true; this.onShow(); this.emit();
      return { status:'project-opened', id, revision:this.revision };
    });
  }
  async close() {
    return this.exclusive(async () => {
      if (this.session) {
        const saved = (await this.session.save()).value;
        // Preserve unrun edits and the last live state together on return to built-in worlds.
        const project = this.runningRevision === this.revision ? saved : { ...withoutIntegrity(this.draft), state:saved.state, runtime:saved.runtime };
        await this.persist(project); this.draft = project;
        this.session.close(); this.session = null; this.runningRevision = null;
        this.stopFrameError?.(); this.onActivate(null);
      }
      this.visible = false; this.emit();
      return { status:'project-closed' };
    });
  }
  dispose() { this.stopFrameError?.(); this.session?.close(); this.listeners.clear(); }
  wrapTools(base) {
    const controller = this;
    const definitions = [
      { name:'readStudioProject', description:'Read Studio code project source, revision, API guide, starter, local saves and live dynamic actions.', parameters:{ type:'object', properties:{}, additionalProperties:false } },
      { name:'writeStudioProject', description:'Create or modify a complete executable Studio world. Saves source draft locally; run separately. Read first for API guide. create=true starts a project; edits require expectedRevision.', parameters:{ type:'object', properties:{ create:{type:'boolean'}, source:{type:'string'}, name:{type:'string'}, expectedRevision:{type:'integer'} }, additionalProperties:false } },
      { name:'patchStudioProject', description:'Edit exactly one unique source fragment in the current project without resending the full file. Call readStudioProject first. Supply exact oldText, newText and expectedRevision. Conflicts or ambiguous matches do not change the draft. Run separately.', parameters:{ type:'object', properties:{ oldText:{type:'string',minLength:1}, newText:{type:'string'}, expectedRevision:{type:'integer',minimum:0} }, required:['oldText','newText','expectedRevision'],additionalProperties:false } },
      ...['run','save','open','close'].map(operation => ({ name:operation+'StudioProject', description:({run:'Run the current source draft in Studio, preserving live serialized state. Failed setup keeps old world.',save:'Save the running source, resources, current custom state and assets to local project library.',open:'Open a saved project draft by id; run separately.',close:'Save live state and return to built-in world.'})[operation], parameters:{ type:'object', properties:operation==='open'?{id:{type:'string'}}:operation==='run'?{expectedRevision:{type:'integer'}}:{}, ...(operation==='open'?{required:['id']}:{}), additionalProperties:false } }))
    ];
    const names = new Set(definitions.map(item => item.name));
    return {
      get runtime() { return controller.world; },
      get actor() { return controller.scene.actors().selected; },
      definitions:() => [...(controller.activeTools && controller.session ? controller.activeTools : base).definitions(), ...definitions],
      executionPolicy(name, result) {
        if (names.has(name)) return { mutates:name!=='readStudioProject', history:false, barrier:name!=='readStudioProject', batchable:false, tracksUnresolved:false, outcome:{ state:result?.error?'failed':'accepted', verified:false } };
        return (controller.session ? controller.activeTools : base).executionPolicy(name,result);
      },
      taskObservation:state => (controller.session ? controller.activeTools : base).taskObservation(state),
      recordSequence:payload => {
        if (controller.session) controller.activeTools.recordSequence(payload);
        base.recordSequence(payload);
      },
      async call(name, args = {}, context = {}) {
        if (context.signal?.aborted) throw fail('TASK_CANCELLED');
        if (names.has(name) || controller.session) base.runtime.events.emit('tool.called', {name,args,source:base.source});
        if (name === 'readStudioProject') { await controller.refresh(); return controller.read(); }
        if (name === 'writeStudioProject') return controller.write(args);
        if (name === 'patchStudioProject') return controller.patch(args);
        if (name === 'runStudioProject') return controller.run(args);
        if (name === 'saveStudioProject') return controller.save();
        if (name === 'openStudioProject') return controller.load(args.id);
        if (name === 'closeStudioProject') return controller.close();
        if (controller.busy) throw fail('PROJECT_BUSY');
        if (!controller.session) return base.call(name,args,context);
        if (SCENE_LEGACY_SKILLS.includes(name)) return controller.scene.executeSkill(name,args);
        return controller.activeTools.call(name,args,context);
      }
    };
  }
}
