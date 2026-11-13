import { describe, it, expect } from 'vitest';
import { formFieldsForAction, initialActionFieldValues, actionArgumentsFromFields } from '../../apps/studio/react/world/ProjectActionArguments.js';

const schema = {
 type:'object', properties:{
  destination:{type:'string',description:'目标区域'},
  speed:{type:'number',minimum:0.1,maximum:10,default:2},
  count:{type:'integer',minimum:0},
  enabled:{type:'boolean'},
  mode:{type:'string',enum:['walk','fly']}
 }, required:['destination','speed'], additionalProperties:false
};

describe('custom project action argument forms',()=>{
 it('builds typed arguments and omits unset optional fields',()=>{
  const fields=formFieldsForAction(schema);
  expect(fields.map(field=>field.name)).toEqual(['destination','speed','count','enabled','mode']);
  expect(initialActionFieldValues(fields)).toEqual({speed:'2'});
  expect(actionArgumentsFromFields(fields,{destination:'garden',speed:'2',enabled:'false',mode:'fly'}))
   .toEqual({destination:'garden',speed:2,enabled:false,mode:'fly'});
 });
 it('rejects missing required, invalid number, out-of-range and enum values before starting a job',()=>{
  const fields=formFieldsForAction(schema);
  expect(()=>actionArgumentsFromFields(fields,{speed:'2'})).toThrow('请填写动作参数：destination');
  expect(()=>actionArgumentsFromFields(fields,{destination:'garden',speed:'abc'})).toThrow('有效数字');
  expect(()=>actionArgumentsFromFields(fields,{destination:'garden',speed:'11'})).toThrow('超出范围');
  expect(()=>actionArgumentsFromFields(fields,{destination:'garden',speed:'2',count:'1.5'})).toThrow('有效数字');
  expect(()=>actionArgumentsFromFields(fields,{destination:'garden',speed:'2',mode:'unknown'})).toThrow('不在允许值内');
 });
 it('handles enum numbers and boolean values without stringifying final arguments',()=>{
  const fields=formFieldsForAction({type:'object',properties:{
   level:{type:'integer',enum:[1,2]},toggle:{type:'boolean',enum:[true,false]}
  },required:[],additionalProperties:false});
  expect(actionArgumentsFromFields(fields,{level:'2',toggle:'false'})).toEqual({level:2,toggle:false});
 });
 it('falls back to raw JSON for nested, unions or unsupported schemas',()=>{
  for(const unsupported of [
   {type:'object',properties:{point:{type:'array',items:{type:'number'}}}},
   {type:'object',properties:{config:{type:'object'}}},
   {type:'object',properties:{count:{oneOf:[{type:'number'},{type:'string'}]}}},
   {type:'object',properties:{angle:{type:'number'}},required:['missing']},
   {type:'array',items:{type:'string'}}
  ]) expect(formFieldsForAction(unsupported)).toBeNull();
 });
});
