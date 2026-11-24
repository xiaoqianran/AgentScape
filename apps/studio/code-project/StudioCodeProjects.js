import { openCodeProject, parseCodeProject } from '../../../application/native-scene/CodeProject.js';
import { AgentTools } from '../../../application/AgentTools.js';
import { SCENE_LEGACY_SKILLS } from '../../../application/scene/SceneFacade.js';
import { AuthoringWorldStore } from '../persistence/AuthoringWorldStore.js';
import { projectTemplate, projectGuide } from './projectTemplate.js';
import { projectFileEntries, compileCodeProjectModules } from '../../../application/native-scene/CodeProjectModules.js';
import { applyProjectChanges, summarizeProjectChanges, patchProjectText } from './StudioProjectChanges.js';
import { projectExecutionFingerprint } from './ProjectExecutionPolicy.js';
import { SharedWorldRepository } from './SharedWorldRepository.js';
import { createSceneObserver } from '../../../application/native-scene/SceneObserver.js';

const fail = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);
const withoutIntegrity = ({ integrity, ...value }) => value;
const mergeLiveState=(draft,live)=>{
  const next=withoutIntegrity(draft);
  for(const field of ['state','runtime','edits','machines']){
    if(Object.hasOwn(live,field))next[field]=live[field];
    else delete next[field];
  }
  return next;
};

/** Studio project ownership. Source drafts and live state have distinct revisions. */
export class StudioCodeProjects {
  constructor({ container, baseScene, baseWorld, store = new AuthoringWorldStore({ databaseName:'agentscape-code-projects' }),
    open = openCodeProject, onActivate = () => {}, onShow = () => {}, executionPolicy = null,
    repository = new SharedWorldRepository() } = {}) {
    if (executionPolicy && typeof executionPolicy.beforeRun !== 'function') throw new TypeError('PROJECT_EXECUTION_POLICY_INVALID');
    Object.assign(this, { container, baseScene, baseWorld, store, open, onActivate, onShow, executionPolicy, repository });
    this.session = null; this.draft = null; this.revision = 0; this.runningRevision = null;
    this.requiresExplicitRun = false;
    this.runtimeId = null;
    this.listeners = new Set(); this.busy = false; this.visible = false;
    this.pendingBatch = null; this.lastBatch = null; this.approval = null;
    this.current = Object.freeze({ visible:false, active:false, busy:false, project:null, revision:0, runningRevision:null, runtimeId:null,
      approvalRequired:Boolean(executionPolicy?.requiresApproval), requiresExplicitRun:false, projects:[], sharedWorlds:[], sharedStatus:null, error:null });
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.current;
  get scene() { return this.session?.scene || this.baseScene; }
  get world() { return this.session?.world || this.baseWorld; }
  visualObject(id) {
    return this.session?.scene.native?.editables?.getObject(id)
      || this.session?.world.store.get(id)?.object || null;
  }
  emit(patch = {}) {
    this.current = Object.freeze({ ...this.current, visible:this.visible, active:Boolean(this.session), busy:this.busy,
      project:this.draft ? clone(this.draft) : null, revision:this.revision, runningRevision:this.runningRevision,
      requiresExplicitRun:this.requiresExplicitRun, runtimeId:this.runtimeId,
      playback:this.session?.playback?.status()||null,
      approval:this.approval ? { revision:this.approval.revision, digest:this.approval.digest.slice(0,12) } : null,
      batchPreview:this.pendingBatch?.summary || null,
      undoBatch:this.lastBatch ? { revision:this.lastBatch.revision, ...this.lastBatch.counts } : null,
      ...patch });
    for (const listener of this.listeners) listener();
  }
  show() { this.visible = true; this.onShow(true); this.emit(); void this.refresh().catch(error => this.emit({ error:error.message })); }
  async refresh({shared=true}={}) {
    const projects=await this.store.list();
    if(!shared){this.emit({projects});return;}
    let sharedWorlds=[],sharedStatus='ready';
    try{
      const remote=await this.repository.list({kind:'code-project'});
      sharedWorlds=remote.worlds;
    }catch(error){sharedStatus=error.code||'WORLD_REPOSITORY_OFFLINE';}
    this.emit({projects,sharedWorlds,sharedStatus});
  }
  /** Explicit, optimistic publication of the running code + current visual edits. */
  async publishShared({token}={}) {
    return this.exclusive(async()=>{
      if(!this.session||!this.draft)throw fail('RUN_PROJECT_FIRST');
      if(this.runningRevision!==this.revision)throw fail('RUN_DRAFT_BEFORE_SAVE');
      const project=(await this.session.save()).value;
      await this.persist(project);
      this.draft=project;
      this.emit();
      const meta=await this.repository.publish({kind:'code-project',content:project,token});
      await this.refresh();
      this.emit();
      return {status:'world-published',...meta};
    });
  }
  /** Import a shared project into the local draft store without auto executing JS. */
  async importShared(id) {
    const saved=await this.repository.openCode(id);
    if(await this.store.load(id))throw fail('WORLD_REPOSITORY_LOCAL_CONFLICT');
    const result=await this.write({create:true,project:saved.content,requiresExplicitRun:true});
    this.repository.remember(id,saved.version);
    return {...result,sharedVersion:saved.version};
  }
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
      hasVisualEdits:Boolean(project.edits && Object.keys(project.edits.overrides).length),
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
  async persist(project = this.draft, revision = this.revision, requiresExplicitRun=this.draft?.id===project.id&&this.requiresExplicitRun) {
    await this.store.save({ id:project.id, name:project.name, document:{ project, revision, requiresExplicitRun } });
    // Local edits must never wait for shared-network access or an offline repository.
    await this.refresh({shared:false});
  }
  async write({ project, source, name, expectedRevision, create = false, patch = null, requiresExplicitRun=false } = {}) {
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
      const explicit=create?Boolean(requiresExplicitRun):this.requiresExplicitRun;
      await this.persist(next, revision, explicit);
      this.requiresExplicitRun=explicit;
      this.draft = next; this.revision = revision; this.runningRevision = create ? null : this.runningRevision; this.approval = null;
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
  /** Optional approval policy hook; only the Studio editor can grant a revision approval. */
  async approveCurrentRevision() {
    return this.exclusive(async () => {
      if (!this.draft) throw fail('PROJECT_REQUIRED');
      const digest = await projectExecutionFingerprint(this.draft,this.revision);
      this.approval = { id:this.draft.id, revision:this.revision, digest };
      this.emit();
      return { id:this.draft.id, revision:this.revision, digest:digest.slice(0,12) };
    });
  }
  async run({ expectedRevision } = {}) {
    return this.exclusive(async () => {
      if (!this.draft) throw fail('PROJECT_REQUIRED');
      if (expectedRevision !== undefined && expectedRevision !== this.revision) throw fail('PROJECT_REVISION_CONFLICT');
      await this.executionPolicy?.beforeRun({ approval:this.approval, project:this.draft, revision:this.revision });
      // Saving acquires the Scene lock; pending actions must settle before replacement.
      const old = this.session;
      const live = old ? (await old.save()).value : null;
      if (!old && this.baseWorld.mutationOwner) throw fail('SCENE_BUSY');
      const project = live && live.id === this.draft.id
        ? mergeLiveState(this.draft,live) : this.draft;
      const next = await this.open({ project, container:this.container, authorized:true });
      let observation;
      try {
        // 新实例观察成功后再释放旧实例，防止失败时丢失运行状态。
        observation = next.scene.observe();
      } catch (error) {
        next.close();
        throw error;
      }
      const previousRevision = this.runningRevision;
      const previousTools = this.activeTools;
      const previousFrameError = this.stopFrameError;
      let nextFrameError = null;
      try {
        nextFrameError = next.world.events.on('project.frame.failed', ({ message }) => this.emit({ error:message }));
        this.session = next;
        this.runningRevision = this.revision;
        this.activeTools = new AgentTools(next.world, { profile:'builder', source:'agent' });
        // 先切换外部视图，再释放旧会话；失败时仍可恢复旧 World。
        this.onActivate(next);
        old?.close();
      } catch (error) {
        this.session = old;
        this.runningRevision = previousRevision;
        this.activeTools = previousTools;
        nextFrameError?.();
        try { this.onActivate(old); } catch { /* 保留首次错误 */ }
        try { next.close(); } catch { /* 保留首次错误 */ }
        throw error;
      }
      previousFrameError?.();
      this.stopFrameError = nextFrameError;
      this.runtimeId=crypto.randomUUID();
      this.emit();
      return { status:'project-running', id:project.id, revision:this.revision, runtimeId:this.runtimeId, observation };
    });
  }
  /** Guard live runtime paths and prevent using a stale path after rerunning the same draft. */
  requireRunningRevision(expectedRevision,expectedRuntimeId,expectedSceneRevision) {
    if(this.busy)throw fail('PROJECT_BUSY');
    if(expectedRevision!==this.revision||this.runningRevision!==this.revision)
      throw fail('PROJECT_REVISION_CONFLICT');
    if(expectedRuntimeId!==undefined&&expectedRuntimeId!==this.runtimeId)throw fail('PROJECT_RUNTIME_CONFLICT');
    if(expectedSceneRevision!==undefined&&this.session?.scene.observe({limit:1}).revision!==expectedSceneRevision)
      throw fail('NATIVE_INSPECT_SCENE_CONFLICT');
  }
  /** One observer service for GUI and MCP, guarded by the live project revision. */
  observeNative(method,{expectedRevision,expectedRuntimeId,expectedSceneRevision,...options}={}){
    if(!this.session||!this.draft)throw fail(method==='capture'?'VISUAL_PROJECT_NOT_RUNNING':'NATIVE_INSPECT_UNAVAILABLE');
    this.requireRunningRevision(expectedRevision,expectedRuntimeId,expectedSceneRevision);
    const session=this.session,sceneRevision=session.scene.observe({limit:1}).revision;
    const observer=createSceneObserver(session.scene.native,{renderCurrent:()=>session.renderCurrent()});
    const evidence=observer[method](options);
    if(this.session!==session||this.runningRevision!==this.revision)throw fail('PROJECT_REVISION_CONFLICT');
    if(session.scene.observe({limit:1}).revision!==sceneRevision)throw fail(method==='capture'?'SCENE_REVISION_CHANGED':'NATIVE_INSPECT_SCENE_CONFLICT');
    return {projectId:this.draft.id,revision:this.revision,runtimeId:this.runtimeId,sceneRevision,...evidence,
      ...((method==='inspect'||method==='capture')&&session.playback?{playback:session.playback.status()}: {})};
  }
  inspect(options){return this.observeNative('inspect',options);}
  search(options){return this.observeNative('search',options);}
  inspectBatch(options){return this.observeNative('inspectBatch',options);}
  suggestViews(options){return this.observeNative('suggestViews',options);}
  async timeline({expectedRevision,expectedRuntimeId,expectedSceneRevision,command='status',steps=1}={}) {
    if(!this.session||!this.draft||!this.session.playback)throw fail('PROJECT_PLAYBACK_UNAVAILABLE');
    this.requireRunningRevision(expectedRevision,expectedRuntimeId,expectedSceneRevision);
    const session=this.session;
    const result=command==='status'?session.playback.status():await this.exclusive(()=>session.playback.control({command,steps}));
    if(this.session!==session||this.runningRevision!==this.revision)throw fail('PROJECT_RUNTIME_CONFLICT');
    return {status:'playback',projectId:this.draft.id,revision:this.revision,runtimeId:this.runtimeId,
      sceneRevision:session.scene.observe({limit:1}).revision,...result};
  }
  capture(options){return this.observeNative('capture',options);}
  async save() {
    return this.exclusive(async () => {
      if (!this.session) throw fail('RUN_PROJECT_FIRST');
      if (this.runningRevision !== this.revision) throw fail('RUN_DRAFT_BEFORE_SAVE');
      const result = await this.session.save();
      await this.persist(result.value);
      this.draft = result.value; this.emit();
      return {...result,projectId:result.value.id,projectRevision:this.revision,runtimeId:this.runtimeId};
    });
  }
  async load(id) {
    return this.exclusive(async () => {
      if (this.session) throw fail('CLOSE_PROJECT_BEFORE_OPEN');
      const saved = await this.store.load(id);
      if (!saved) throw fail('PROJECT_NOT_FOUND');
      const project = await parseCodeProject(saved.document.project);
      this.requiresExplicitRun=Boolean(saved.document.requiresExplicitRun ?? this.repository.versionOf?.(id));
      this.draft = project; this.revision = Math.max(this.revision + 1, saved.document.revision); this.runningRevision = null; this.approval = null;
      this.pendingBatch = null; this.lastBatch = null;
      this.visible = true; this.onShow(); this.emit();
      return { status:'project-opened', id, revision:this.revision };
    });
  }
  async createForTask({ id }) {
    if (!/^world_[a-f0-9]{32}$/.test(id || '')) throw fail('PROJECT_ID_INVALID');
    return this.exclusive(async () => {
      if (this.draft?.id === id) return { id, revision:this.revision };
      const saved = await this.store.load(id);
      const project = await parseCodeProject(saved?.document.project || {
        schema:'agentscape.code-project', schemaVersion:1, id,
        name:'New world', source:projectTemplate, resources:{}
      });
      await this.closeProject();
      const revision = Math.max(this.revision + 1, saved?.document.revision || 0);
      const explicit=Boolean(saved?.document.requiresExplicitRun ?? this.repository.versionOf?.(id));
      await this.persist(project, revision,explicit);
      this.requiresExplicitRun=explicit;
      this.draft = project;
      this.revision = revision;
      this.approval = null;
      this.visible = true;
      this.onShow();
      return { id, revision };
    });
  }
  async close() {
    return this.exclusive(() => this.closeProject());
  }
  async closeProject() {
    if (this.session) {
      const saved = (await this.session.save()).value;
      // Preserve unrun edits and the last live state together on return to built-in worlds.
      const project = this.runningRevision === this.revision ? saved : mergeLiveState(this.draft,saved);
      await this.persist(project); this.draft = project;
      const previous = this.session;
      // 返回内置 World 前先切换外部视图；回调失败仍保留原会话。
      this.session = null;
      try {
        this.onActivate(null);
        previous.close();
      } catch (error) {
        this.session = previous;
        try { this.onActivate(previous); } catch { /* 保留首次错误 */ }
        throw error;
      }
      this.runningRevision = null;
      this.runtimeId=null;
      this.stopFrameError?.();
      this.stopFrameError = null;
    }
    this.pendingBatch = null; this.lastBatch = null; this.approval = null;
    this.visible = false; this.emit();
    return { status:'project-closed' };
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
