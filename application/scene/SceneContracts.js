import * as z from 'zod/v4';
import { recipeSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { mechanicalDraftSchema } from '../../modules/asset/model/MechanicalAssetDraft.js';
import { sceneObjectIdSchema as id, sceneTransformSchema, sceneVector3Schema } from './SceneProject.js';

export const sceneError = (code, message = code) => Object.assign(new Error(message), { code });
export const ref = z.string().regex(/^(builtin:\/\/[a-zA-Z][a-zA-Z0-9_-]{0,63}|asset:\/\/sha256\/[a-f0-9]{64})$/);
export const level = z.enum(['visual', 'physical', 'interactive']).default('physical');
export const modelSchema = z.object({ id, asset: ref, level, transform: sceneTransformSchema.optional(), position: sceneVector3Schema.optional() }).strict().refine(v => !v.transform || !v.position, 'Use transform or position');
export const sceneAgentModelSchema = z.object({ id, asset: z.union([ref, recipeSchema, mechanicalDraftSchema]), level: z.enum(['visual', 'physical', 'interactive']).optional(), transform: sceneTransformSchema.optional(), position: sceneVector3Schema.optional() }).strict().refine(v => !v.transform || !v.position, 'Use transform or position');
export const operations = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), model: modelSchema }).strict(),
  z.object({ type: z.literal('setTransform'), id, transform: sceneTransformSchema }).strict(),
  z.object({ type: z.literal('remove'), id }).strict(),
  z.object({ type: z.literal('replaceAsset'), id, asset: ref, level }).strict()
]);
export const applySchema = z.object({ requestId: z.union([id,z.uuid()]).optional(), expectedRevision: z.number().int().nonnegative().optional(), operations: z.array(operations).min(1).max(32) }).strict();
const operationVector = sceneVector3Schema.refine(value => Math.hypot(...value) > 1e-6, 'Direction must be nonzero');
const affordanceTarget = z.string().regex(/^[A-Za-z][A-Za-z0-9_:-]{0,255}$/);
export const sceneInteractionSchema = z.discriminatedUnion('action', [
  z.object({ action:z.literal('invoke'), target:z.string().min(1).max(256), name:z.string().min(1).max(256), actor:id.optional(), partName:id.optional(), source:z.enum(['asset','environment','project']).optional(), args:z.record(z.string(),z.unknown()).default({}) }).strict(),
  z.object({ action: z.literal('custom'), target: z.string().min(1).max(256), name: z.string().min(1).max(256), actor: id.optional(), args: z.record(z.string(), z.unknown()).default({}) }).strict(),
  z.object({ action: z.literal('navigate'), actor: id, position: sceneVector3Schema }).strict(),
  z.object({ action: z.literal('activate'), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('pickup'), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('place'), actor: id, target: affordanceTarget, surfaceId: id.optional() }).strict(),
  z.object({ action: z.enum(['open', 'close']), actor: id, target: affordanceTarget, partName: id.optional() }).strict(),
  z.object({ action: z.enum(['turn_on', 'turn_off', 'pull_out', 'return']), actor: id, target: affordanceTarget }).strict(),
  z.object({ action: z.literal('write'), actor: id, target: affordanceTarget, args: z.object({ text: z.string().max(100) }).strict() }).strict(),
  z.object({ action: z.enum(['push', 'drag']), actor: id, target: affordanceTarget, args: z.object({
    direction: operationVector.refine(value => Math.abs(value[1]) < 1e-6, 'Linear contact operations require a horizontal direction'),
    distance: z.number().positive().max(5), maxForce: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('rotate'), actor: id, target: affordanceTarget, args: z.object({
    axis: operationVector, angle: z.number().finite().min(-Math.PI).max(Math.PI).refine(value => value !== 0),
    maxTorque: z.number().positive().max(1000).default(100)
  }).strict() }).strict(),
  z.object({ action: z.literal('slide'), actor: id, target: affordanceTarget, args: z.object({ part: id,
    target: z.number().finite().optional(), distance: z.number().finite().optional()
  }).strict().refine(value => (value.target != null) !== (value.distance != null), 'Use target or distance') }).strict(),
  z.object({ action: z.literal('rotateJoint'), actor: id, target: affordanceTarget, args: z.object({ part: id,
    target: z.number().finite().optional(), angle: z.number().finite().min(-Math.PI).max(Math.PI).optional()
  }).strict().refine(value => (value.target != null) !== (value.angle != null), 'Use target or angle') }).strict()
]);
export const diagnostic = error => ({ code: error.code || 'INVALID_OPERATION', message: error.code || 'Operation failed', stage: 'scene', retryable: false });
