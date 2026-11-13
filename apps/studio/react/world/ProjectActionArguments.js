/** Human-facing inputs for the scalar subset of custom-action JSON Schema. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

export function formFieldsForAction(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object'
    || Array.isArray(schema.properties) || schema.patternProperties || schema.oneOf || schema.anyOf || schema.allOf) return null;
  const entries = Object.entries(schema.properties);
  if (entries.length > 20 || !Array.isArray(schema.required ?? [])) return null;
  const required = new Set(schema.required || []);
  if ([...required].some(key => !Object.prototype.hasOwnProperty.call(schema.properties, key))) return null;
  const fields = [];
  for (const [name, definition] of entries) {
    if (!definition || !SCALAR_TYPES.has(definition.type) || definition.oneOf || definition.anyOf || definition.allOf) return null;
    if (definition.enum && (!Array.isArray(definition.enum) || definition.enum.some(value => {
      if (definition.type === 'integer') return !Number.isInteger(value);
      return typeof value !== (definition.type === 'integer' ? 'number' : definition.type);
    }))) return null;
    fields.push({ name, type:definition.type, required:required.has(name), description:definition.description || '',
      values:definition.enum || null, minimum:definition.minimum, maximum:definition.maximum,
      defaultValue:definition.default });
  }
  return fields;
}

export function initialActionFieldValues(fields) {
  return Object.fromEntries(fields.filter(field => field.defaultValue !== undefined)
    .map(field => [field.name, String(field.defaultValue)]));
}

export function actionArgumentsFromFields(fields, values) {
  const args = {};
  for (const field of fields) {
    const raw = values[field.name] ?? '';
    if (raw === '') {
      if (field.required) throw new Error('请填写动作参数：' + field.name);
      continue;
    }
    let value = raw;
    if (field.type === 'number' || field.type === 'integer') {
      value = Number(raw);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw new Error('动作参数应为有效数字：' + field.name);
      if (field.minimum != null && value < field.minimum || field.maximum != null && value > field.maximum)
        throw new Error('动作参数超出范围：' + field.name);
    } else if (field.type === 'boolean') {
      if (!['true', 'false'].includes(raw)) throw new Error('动作参数应为布尔值：' + field.name);
      value = raw === 'true';
    }
    if (field.values && !field.values.includes(value)) throw new Error('动作参数不在允许值内：' + field.name);
    args[field.name] = value;
  }
  return args;
}
