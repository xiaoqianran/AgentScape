import * as z from 'zod/v4';
import { sceneObjectIdSchema, sceneVector3Schema } from './SceneProject.js';

// Pure schema: both SceneFacade and NativeSceneHost depend on this contract.
// Never import the native runtime into the generic Scene application layer.
const quaternion = z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])
  .refine(value=>Math.abs(Math.hypot(...value)-1)<1e-4);
const positiveScale = z.tuple([z.number().positive().max(100),z.number().positive().max(100),z.number().positive().max(100)]);
export const nativeEditableChangesSchema = z.object({
  position:sceneVector3Schema.optional(),
  quaternion:quaternion.optional(),
  scale:positiveScale.optional(),
  visible:z.boolean().optional()
}).strict().refine(value=>Object.keys(value).length>0,'At least one editable property is required');
export const nativeEditableSnapshotSchema = z.object({
  schema:z.literal('agentscape.native-edits'),schemaVersion:z.literal(1),
  overrides:z.record(sceneObjectIdSchema,nativeEditableChangesSchema)
}).strict();
