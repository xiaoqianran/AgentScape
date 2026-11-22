import * as THREE from 'three';
import { sceneObjectIdSchema } from '../scene/SceneProject.js';
import { nativeEditableChangesSchema, nativeEditableSnapshotSchema } from '../scene/NativeEditableContracts.js';

const fail = code => Object.assign(new Error(code), {code});
const PROPERTIES=['position','quaternion','scale','visible'];
const read = object => ({
  position:object.position.toArray(),quaternion:object.quaternion.toArray(),
  scale:object.scale.toArray(),visible:object.visible
});
const apply = (object,changes) => {
  if(changes.position)object.position.fromArray(changes.position);
  if(changes.quaternion)object.quaternion.fromArray(changes.quaternion);
  if(changes.scale)object.scale.fromArray(changes.scale);
  if(changes.visible!==undefined)object.visible=changes.visible;
  object.updateMatrix();
};

/**
 * Per-native-Scene registry: live Three.js objects are code-owned; only their
 * explicitly exposed properties have editor-owned, serializable overrides.
 * Mutation is private to SceneFacade.apply(), shared by Studio and MCP.
 */
export class NativeEditableRegistry {
  constructor(scene,world) {this.scene=scene;this.world=world;this.records=new Map();this.overrides=new Map();}
  register({id,object,label=id,properties=PROPERTIES}={}) {
    if(!sceneObjectIdSchema.safeParse(id).success)throw fail('NATIVE_EDIT_ID_INVALID');
    if(!(object instanceof THREE.Object3D)||!object.isObject3D)throw fail('NATIVE_EDIT_OBJECT_INVALID');
    let parent=object;
    while(parent&&parent!==this.scene)parent=parent.parent;
    if(!parent)throw fail('NATIVE_EDIT_OBJECT_NOT_MOUNTED');
    if(this.records.has(id)||this.world.store.has(id))throw fail('NATIVE_EDIT_ID_CONFLICT');
    const existingProjectEntity=this.world.projectCapabilities.entities.get(id);
    if(existingProjectEntity?.object && existingProjectEntity.object!==object)
      throw fail('NATIVE_EDIT_ID_CONFLICT');
    if(typeof label!=='string'||!label.length||label.length>128)throw fail('NATIVE_EDIT_LABEL_INVALID');
    if(!Array.isArray(properties)||!properties.length||new Set(properties).size!==properties.length
      ||properties.some(prop=>!PROPERTIES.includes(prop)))throw fail('NATIVE_EDIT_PROPERTIES_INVALID');
    const record={id,label,object,properties:Object.freeze([...properties])};
    const pending=this.overrides.get(id);
    if(pending){
      if(Object.keys(pending).some(prop=>!record.properties.includes(prop)))
        throw fail('NATIVE_EDIT_PROPERTY_REVOKED');
      const before=read(object);
      try{apply(object,pending);}
      catch(error){apply(object,before);throw error;}
    }
    this.records.set(id,record);
    this.world.events?.emit('native.edit.registered',{id});
    return ()=>{if(this.records.get(id)===record){
      this.records.delete(id);
      this.world.events?.emit('native.edit.unregistered',{id});
    }};
  }
  has(id) {return this.records.has(id);}
  objectFor(id){return this.records.get(id)?.object || null;}
  read(id) {
    const record=this.records.get(id);
    if(!record)return null;
    return {id,label:record.label,source:'code',properties:[...record.properties],transform:read(record.object)};
  }
  list() {
    return {total:this.records.size,objects:[...this.records.keys()].map(id=>this.read(id)),
      unresolved:[...this.overrides.keys()].filter(id=>!this.records.has(id))};
  }
  /** Capture only the explicitly edited keys, including whether each had a saved override. */
  captureEdit(id,keys) {
    const record=this.records.get(id);
    if(!record)throw fail('NATIVE_EDIT_OBJECT_NOT_FOUND');
    const live=read(record.object), overrides=this.overrides.get(id)||{};
    return {id,fields:Object.fromEntries(keys.map(key=>[key,{
      value:structuredClone(live[key]),hasOverride:Object.hasOwn(overrides,key),
      ...(Object.hasOwn(overrides,key)?{override:structuredClone(overrides[key])}:{})
    }]))};
  }
  /** Replays a historical value without creating another history command. */
  restoreEdit(snapshot) {
    const record=this.records.get(snapshot.id);
    if(!record)throw fail('NATIVE_EDIT_OBJECT_NOT_FOUND');
    const changes={},next={...(this.overrides.get(snapshot.id)||{})};
    for(const [key,entry] of Object.entries(snapshot.fields)){
      if(!record.properties.includes(key))throw fail('NATIVE_EDIT_PROPERTY_REVOKED');
      changes[key]=structuredClone(entry.value);
      if(entry.hasOverride)next[key]=structuredClone(entry.override);
      else delete next[key];
    }
    nativeEditableChangesSchema.parse(changes);
    const previous=read(record.object);
    try {apply(record.object,changes);}catch(error){apply(record.object,previous);throw error;}
    if(Object.keys(next).length)this.overrides.set(snapshot.id,next);
    else this.overrides.delete(snapshot.id);
    this.world.events?.emit('native.edit.changed',{id:snapshot.id,properties:Object.keys(changes)});
    return this.read(snapshot.id);
  }
  /** Only SceneEditService may invoke edit; callers must pass the Scene lock/revision gate. */
  edit(id,input) {
    const record=this.records.get(id);
    if(!record)throw fail('NATIVE_EDIT_OBJECT_NOT_FOUND');
    const changes=nativeEditableChangesSchema.parse(input);
    if(Object.keys(changes).some(prop=>!record.properties.includes(prop)))throw fail('NATIVE_EDIT_PROPERTY_FORBIDDEN');
    const before=read(record.object);
    try{apply(record.object,changes);}
    catch(error){apply(record.object,before);throw error;}
    this.overrides.set(id,{...this.overrides.get(id),...changes});
    return this.read(id);
  }
  /** Validate all saved changes before mutating the new scene. Missing IDs remain visible as unresolved. */
  restore(snapshot) {
    if(snapshot==null)return this.list();
    const {overrides}=nativeEditableSnapshotSchema.parse(snapshot);
    for(const [id,changes] of Object.entries(overrides)){
      const record=this.records.get(id);
      if(record&&Object.keys(changes).some(prop=>!record.properties.includes(prop)))
        throw fail('NATIVE_EDIT_PROPERTY_REVOKED');
    }
    const previous=[...this.records.values()].map(record=>[record.object,read(record.object)]);
    const existing=this.overrides;
    try{
      this.overrides=new Map();
      for(const [id,changes] of Object.entries(overrides)){
        this.overrides.set(id,structuredClone(changes));
        const record=this.records.get(id);
        if(record)apply(record.object,changes);
      }
      return this.list();
    }catch(error){
      for(const [object,transform] of previous)apply(object,transform);
      this.overrides=existing;
      throw error;
    }
  }
  export() {
    if(!this.overrides.size)return null;
    return {schema:'agentscape.native-edits',schemaVersion:1,
      overrides:Object.fromEntries([...this.overrides].map(([id,value])=>[id,structuredClone(value)]))};
  }
  dispose(){this.records.clear();this.overrides.clear();}
}
