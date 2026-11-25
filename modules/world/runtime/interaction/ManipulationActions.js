export const rigidBodyActions=Object.freeze(['push','drag','rotate']);

/** The same parameter contract for native and managed rigid bodies. */
export function manipulationParameters(action){
  return action === 'rotate' ? { axis:{type:'array',length:3,nonzero:true,required:true}, angle:{type:'number',minimum:-Math.PI,maximum:Math.PI,unit:'radian',required:true}, maxTorque:{type:'number',minimum:0,exclusiveMinimum:true,maximum:1000,default:100,unit:'newton-meter'} }
        : { direction:{type:'array',length:3,nonzero:true,horizontal:true,required:true}, distance:{type:'number',minimum:0,exclusiveMinimum:true,maximum:5,unit:'meter',required:true}, maxForce:{type:'number',minimum:0,exclusiveMinimum:true,maximum:1000,default:100,unit:'newton'} };
}
