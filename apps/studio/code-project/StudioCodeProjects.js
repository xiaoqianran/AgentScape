import { openCodeProject, parseCodeProject } from '../../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { SCENE_LEGACY_SKILLS } from '../../../application/scene/SceneFacade.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { projectTemplate, projectGuide } from './projectTemplate.js';
import { projectFileEntries, compileCodeProjectModules } from '../../../application/native-scene/CodeProjectModules.js';
import { applyProjectChanges, summarizeProjectChanges, patchProjectText } from './StudioProjectChanges.js';

const fail = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);
const withoutIntegrity = ({ integrity, ...value }) => value;

/** Studio project ownership. Source drafts and live state have distinct revisions. */
export class StudioCodeProjects {
  constructor({ container, baseScene, baseWorld, store = new AuthoringWorldStore({ databaseName:'agentscape-code-projects' }),
    open = openCodeProject, onActivate = () => {}, onShow = () => {} } = {}) {
    Object.assign(this, { container, baseScene, baseWorld, store, open, onActivate, onShow });
    this.session = null; this.draft = null; this.revision = 0; this.runningRevision = null;
    this.listeners = new Set(); this.busy = false; this.visible = false;
    this.pendingBatch = null; this.lastBatch = null;
    this.current = Object.freeze({ visible:false, active:false, busy:false, project:null, revision:0, runningRevision:null, projects:[], error:null });
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.current;
  get scene() { return this.session?.scene || this.baseScene; }
  get world() { return this.session?.world || this.baseWorld; }
  emit(patch = {}) {
    this.current = Object.freeze({ ...this.current, visible:this.visible, active:Boolean(this.session), busy:this.busy,
      project:this.draft ? clone(this.draft) : null, revision:this.revision, runningRevision:this.runningRevision,
      batchPreview:this.pendingBatch?.summary || null,
      undoBatch:this.lastBatch ? { revision:this.lastBatch.revision, ...this.lastBatch.counts } : null,
      ...patch });
    for (const listener of this.listeners) listener();
  }
  show() { this.visible = true; this.onShow(true); this.emit(); void this.refresh().catch(error => this.emit({ error:error.message })); }
  async refresh() { this.emit({ projects:await this.store.list() }); }
  /** AI/MCP receive bounded metadata, not embedded resource bytes or entire runtime archives. */
  read() {
    const { project, ...metadata } = this.current;
    const summary = project ? {
      schema:project.schema, id:project.id, name:project.name, entry:project.entry || 'main.js',
      source:project.source.slice(0,65536), sourceChars:project.source.length,
      sourceTruncated:project.source.length>65536,
      files:Object.fromEntries(Object.entries(project.files || {}).map(([path,content])=>[path,{chars:content.length}])),
      resources:Object.fromEntries(Object.entries(project.resources || {}).map(([path,value])=>
        [path,{mime:value.mime,encodedChars:value.base64.length}])),
      hasSavedState:Object.hasOwn(project,'state'),
    } : null;
    return { ...clone(metadata), project:summary,guide:projectGuide,starter:projectTemplate,
      observation:this.session?.scene.observe() || null };
  }
  readFile(path, {offset=0,limit=65536} = {}) {
    if (!this.draft) throw fail('PROJECT_REQUIRED');
    const files = projectFileEntries(this.draft);
    if (!Object.hasOwn(files,path)) throw fail('PROJECT_FILE_NOT_FOUND');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 65536)
      throw fail('PROJECT_FILE_READ_RANGE_INVALID');
    const content = files[path], chunk = content.slice(offset,offset+limit);
    return { id:this.draft.id, path, content:chunk, offset, totalChars:content.length,
      nextOffset:offset+chunk.length<content.length?offset+chunk.length:null,
      revision:this.revision, entry:this.draft.entry || 'main.js' };
  }
  async editFile({ expectedRevision, ...change } = {}) {
    if (!this.draft) throw fail('PROJECT_REQUIRED');
    if (expectedRevision !== this.revision) throw fail('PROJECT_REVISION_CONFLICT');
    const next = applyProjectChanges(this.draft,[{ ...change, kind:'file' }]);
    const result = await this.write({project:next,expectedRevision});
    return { ...result,status:'project-file-'+change.action,path:change.path,
      ...(change.newPath ? {newPath:change.newPath} : {}) };
  }
  async editResource({ expectedRevision, ...change } = {}) {
    if (!this.draft) throw fail('PROJECT_REQUIRED');
    if (expectedRevision !== this.revision) throw fail('PROJECT_REVISION_CONFLICT');
    const next = applyProjectChanges(this.draft,[{ ...change, kind:'resource' }]);
    const result = await this.write({project:next,expectedRevision});
    return { ...result,status:'project-resource-'+change.action,path:change.path };
  }
  /** Validate all changes and relative imports first. Review is transient; no draft is persisted. */
  async previewBatch({ operations,expectedRevision } = {}) {
    return this.exclusive(async () => {
      if (!this.draft) throw fail('PROJECT_REQUIRED');
      if (expectedRevision !== this.revision) throw fail('PROJECT_REVISION_CONFLICT');
      const next = await parseCodeProject(applyProjectChanges(this.draft, operations));
      await compileCodeProjectModules(next); // Resolve the module graph without executing project code.
      const changes = summarizeProjectChanges(this.draft,next);
      const previewId = crypto.randomUUID();
      const summary = { status:'project-batch-preview',previewId,baseRevision:this.revision,
        operations:operations.length,...changes };
      this.pendingBatch = { previewId,baseRevision:this.revision,operations:clone(operations),summary };
      this.emit();
      return clone(summary);
    });
  }
  /** One persist, one revision, one undo snapshot. Rebase on the latest runtime state. */
  async applyBatch({ previewId,expectedRevision } = {}) {
    const pending = this.pendingBatch;
    if (!pending || pending.previewId !== previewId) throw fail('PROJECT_BATCH_PREVIEW_NOT_FOUND');
    if (expectedRevision !== pending.baseRevision || this.revision !== pending.baseRevision)
      throw fail('PROJECT_REVISION_CONFLICT');
    const before = clone(withoutIntegrity(this.draft));
    const next = applyProjectChanges(before,pending.operations);
    const result = await this.write({project:next,expectedRevision});
    this.lastBatch = { revision:this.revision,before,
      counts:{files:pending.summary.files,resources:pending.summary.resources} };
    this.emit();
    return { ...result,status:'project-batch-applied',previewId,
      files:pending.summary.files,resources:pending.summary.resources };
  }
  async commitBatch({ operations,expectedRevision } = {}) {
    const preview = await this.previewBatch({operations,expectedRevision});
    return this.applyBatch({previewId:preview.previewId,expectedRevision});
  }
  async discardBatch({ previewId } = {}) {
    return this.exclusive(async () => {
      if (!this.pendingBatch || this.pendingBatch.previewId !== previewId)
        throw fail('PROJECT_BATCH_PREVIEW_NOT_FOUND');
      this.pendingBatch = null;
      this.emit();
      return { status:'project-batch-discarded',previewId };
    });
  }
  /** Revert only the most recently applied batch. Runtime state captured since then is retained. */
  async undoBatch({ expectedRevision } = {}) {
    const previous = this.lastBatch;
    if (!previous) throw fail('PROJECT_BATCH_UNDO_UNAVAILABLE');
    if (expectedRevision !== this.revision || previous.revision !== this.revision)
      throw fail('PROJECT_REVISION_CONFLICT');
    const next = clone(withoutIntegrity(this.draft));
    for (const field of ['name','source','entry','files','resources']) {
      if (Object.hasOwn(previous.before,field)) next[field] = clone(previous.before[field]);
      else delete next[field];
    }
    const result = await this.write({project:next,expectedRevision});
    return { ...result,status:'project-batch-undone',
      files:previous.counts.files,resources:previous.counts.resources };
  }
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
      const nextSource = patch ? patchProjectText(this.draft.source, patch) : source;
      const input = project || (create
        ? { schema:'agentscape.code-project', schemaVersion:1, id:'world_' + crypto.randomUUID().replaceAll('-',''), name:name || '我的代码世界', source:source || projectTemplate, resources:{} }
        : { ...withoutIntegrity(this.draft), ...(nextSource !== undefined ? { source:nextSource } : {}), ...(name !== undefined ? { name } : {}) });
      const next = await parseCodeProject(input);
      if (!create && next.id !== this.draft.id) throw fail('PROJECT_ID_CHANGE_REQUIRES_CREATE');
      const revision = this.revision + 1;
      await this.persist(next, revision);
      this.draft = next; this.revision = revision; this.runningRevision = create ? null : this.runningRevision;
      this.pendingBatch = null; this.lastBatch = null;
      this.visible = true; this.onShow(); this.emit();
      return { status:patch?'project-source-patched':'project-draft-saved', id:next.id, revision };
    });
  }
  /** Atomic unique-substring edit. Revision and persistence share write()'s lock. */
  patch({ path, oldText, newText, expectedRevision } = {}) {
    if (path && path !== (this.draft?.entry || 'main.js'))
      return this.editFile({action:'patch',path,oldText,newText,expectedRevision});
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
      this.pendingBatch = null; this.lastBatch = null;
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
      this.pendingBatch = null; this.lastBatch = null;
      this.visible = false; this.emit();
      return { status:'project-closed' };
    });
  }
  dispose() { this.stopFrameError?.(); this.session?.close(); this.listeners.clear(); this.pendingBatch=null; this.lastBatch=null; }
  wrapTools(base) {
    const controller = this;
    const definitions = [
      { name:'readStudioProject', description:'Read bounded entry-source preview, file/resource manifests, revision, API guide, starter and live dynamic actions. Read auxiliary or large files with readStudioFile.', parameters:{ type:'object', properties:{}, additionalProperties:false } },
      { name:'writeStudioProject', description:'Create or modify a complete executable Studio world. Saves source draft locally; run separately. Read first for API guide. create=true starts a project; edits require expectedRevision.', parameters:{ type:'object', properties:{ create:{type:'boolean'}, source:{type:'string'}, name:{type:'string'}, expectedRevision:{type:'integer'} }, additionalProperties:false } },
      { name:'patchStudioProject', description:'Edit one unique source fragment in the entry file, or pass path for an auxiliary file. Exact oldText/newText and expectedRevision required. Run separately.', parameters:{ type:'object', properties:{ path:{type:'string'}, oldText:{type:'string',minLength:1}, newText:{type:'string'}, expectedRevision:{type:'integer',minimum:0} }, required:['oldText','newText','expectedRevision'],additionalProperties:false } },
      { name:'readStudioFile', description:'Read a bounded slice of one source file using path and optional offset/limit (maximum 65536 characters). nextOffset enables paging.', parameters:{type:'object',properties:{path:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},required:['path'],additionalProperties:false} },
      { name:'editStudioFile', description:'Create, write, patch, rename or delete one Studio source/shader file. Exact revision required. The entry file cannot be deleted. Run project separately after editing.', parameters:{type:'object',properties:{
        action:{type:'string',enum:['create','write','patch','rename','delete']},path:{type:'string'},newPath:{type:'string'},
        content:{type:'string'},oldText:{type:'string'},newText:{type:'string'},name:{type:'string'},expectedRevision:{type:'integer',minimum:0}
      },required:['action','path','expectedRevision'],additionalProperties:false} },
      { name:'editStudioResource', description:'Add or remove one embedded binary project resource (mime and base64 for add). Resource is accessible in project code via resource(path).',
        parameters:{type:'object',properties:{action:{type:'string',enum:['add','delete']},path:{type:'string'},mime:{type:'string'},base64:{type:'string'},expectedRevision:{type:'integer',minimum:0}},
        required:['action','path','expectedRevision'],additionalProperties:false} },
      { name:'previewStudioProjectBatch', description:'Stage 1-32 coordinated file/resource edits against expectedRevision. Preview all code differences without saving; inspect previewId and changes before applying.', parameters:{type:'object',properties:{
        expectedRevision:{type:'integer',minimum:0}, operations:{type:'array',minItems:1,maxItems:32,items:{type:'object',
          properties:{kind:{type:'string',enum:['file','resource']},action:{type:'string',enum:['create','write','patch','rename','delete','add']},
            path:{type:'string'},newPath:{type:'string'},content:{type:'string'},oldText:{type:'string'},newText:{type:'string'},
            mime:{type:'string'},base64:{type:'string'}},required:['kind','action','path'],additionalProperties:false }}
      },required:['expectedRevision','operations'],additionalProperties:false} },
      { name:'applyStudioProjectBatch', description:'Atomically persist the reviewed multi-file batch using previewId and expectedRevision; one revision, one undo. Run separately.', parameters:{type:'object',
        properties:{previewId:{type:'string'},expectedRevision:{type:'integer',minimum:0}},
        required:['previewId','expectedRevision'],additionalProperties:false} },
      { name:'discardStudioProjectBatch', description:'Discard an uncommitted multi-file preview. Does not change project files.',parameters:{type:'object',
        properties:{previewId:{type:'string'}},required:['previewId'],additionalProperties:false} },
      { name:'undoStudioProjectBatch', description:'Undo the last applied multi-file batch if no later edits occurred; retains current runtime state. Run separately.',parameters:{type:'object',
        properties:{expectedRevision:{type:'integer',minimum:0}},required:['expectedRevision'],additionalProperties:false} },
      ...['run','save','open','close'].map(operation => ({ name:operation+'StudioProject', description:({run:'Run the current source draft in Studio, preserving live serialized state. Failed setup keeps old world.',save:'Save the running source, resources, current custom state and assets to local project library.',open:'Open a saved project draft by id; run separately.',close:'Save live state and return to built-in world.'})[operation], parameters:{ type:'object', properties:operation==='open'?{id:{type:'string'}}:operation==='run'?{expectedRevision:{type:'integer'}}:{}, ...(operation==='open'?{required:['id']}:{}), additionalProperties:false } }))
    ];
    const names = new Set(definitions.map(item => item.name));
    return {
      get runtime() { return controller.world; },
      get actor() { return controller.scene.actors().selected; },
      definitions:() => [...(controller.activeTools && controller.session ? controller.activeTools : base).definitions(), ...definitions],
      executionPolicy(name, result) {
        if (names.has(name)) { const mutates=!['readStudioProject','readStudioFile'].includes(name); return { mutates, history:false, barrier:mutates, batchable:false, tracksUnresolved:false, outcome:{ state:result?.error?'failed':'accepted', verified:false } }; }
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
        if (name === 'readStudioFile') return controller.readFile(args.path,args);
        if (name === 'editStudioFile') return controller.editFile(args);
        if (name === 'editStudioResource') return controller.editResource(args);
        if (name === 'previewStudioProjectBatch') return controller.previewBatch(args);
        if (name === 'applyStudioProjectBatch') return controller.applyBatch(args);
        if (name === 'discardStudioProjectBatch') return controller.discardBatch(args);
        if (name === 'undoStudioProjectBatch') return controller.undoBatch(args);
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
