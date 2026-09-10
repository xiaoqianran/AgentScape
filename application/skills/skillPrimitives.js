export const string = { type:'string' };
export const number = { type:'number' };
export const vec3 = { type:'array', items:number, minItems:3, maxItems:3 };
export const meta = (description, permissions, required=[], properties={}) => ({description,permissions,required,properties});
