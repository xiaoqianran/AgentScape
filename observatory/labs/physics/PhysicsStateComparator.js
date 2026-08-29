const finite = (value) => Number.isFinite(value) ? value : null;
const vectorDistance = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return null;
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) return null;
    const delta = left[i] - right[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
};

const bodyKey = (body) => `${body.objectId}:${body.partName || "$root"}`;
const jointKey = (joint) => `${joint.objectId}:${joint.partName || "$root"}`;

export function comparePhysicsSnapshots(left, right) {
  if (!left || !right) return { comparable:false, reason:"MISSING_SNAPSHOT", bodies:[], joints:[], summary:{} };
  const rightBodies = new Map((right.bodies || []).map((body) => [bodyKey(body), body]));
  const rightJoints = new Map((right.joints || []).map((joint) => [jointKey(joint), joint]));

  const bodies = (left.bodies || []).map((body) => {
    const peer = rightBodies.get(bodyKey(body));
    return {
      key:bodyKey(body),
      objectId:body.objectId,
      partName:body.partName,
      presentLeft:true,
      presentRight:Boolean(peer),
      positionDelta:peer ? vectorDistance(body.position,peer.position) : null,
      linearVelocityDelta:peer ? vectorDistance(body.linearVelocity,peer.linearVelocity) : null,
      angularVelocityDelta:peer ? vectorDistance(body.angularVelocity,peer.angularVelocity) : null,
      sleepingEqual:peer ? body.sleeping === peer.sleeping : false
    };
  });
  for (const peer of right.bodies || []) {
    const key=bodyKey(peer);
    if (!bodies.some((body)=>body.key===key)) bodies.push({key,objectId:peer.objectId,partName:peer.partName,presentLeft:false,presentRight:true,positionDelta:null,linearVelocityDelta:null,angularVelocityDelta:null,sleepingEqual:false});
  }

  const joints = (left.joints || []).map((joint) => {
    const peer = rightJoints.get(jointKey(joint));
    const coordinateDelta = peer && Number.isFinite(joint.coordinate) && Number.isFinite(peer.coordinate)
      ? Math.abs(joint.coordinate - peer.coordinate)
      : null;
    return { key:jointKey(joint), objectId:joint.objectId, partName:joint.partName, presentLeft:true, presentRight:Boolean(peer), coordinateDelta };
  });
  for (const peer of right.joints || []) {
    const key=jointKey(peer);
    if (!joints.some((joint)=>joint.key===key)) joints.push({key,objectId:peer.objectId,partName:peer.partName,presentLeft:false,presentRight:true,coordinateDelta:null});
  }

  const max = (values) => {
    const clean = values.map(finite).filter((value) => value != null);
    return clean.length ? Math.max(...clean) : null;
  };
  const missingBodies = bodies.filter((body) => !body.presentLeft || !body.presentRight).length;
  const missingJoints = joints.filter((joint) => !joint.presentLeft || !joint.presentRight).length;
  return {
    comparable:true,
    backends:[left.backend,right.backend],
    bodies,
    joints,
    summary:{
      bodyCountLeft:left.bodies?.length || 0,
      bodyCountRight:right.bodies?.length || 0,
      jointCountLeft:left.joints?.length || 0,
      jointCountRight:right.joints?.length || 0,
      contactCountLeft:left.contacts?.length || 0,
      contactCountRight:right.contacts?.length || 0,
      contactCountDelta:Math.abs((left.contacts?.length || 0)-(right.contacts?.length || 0)),
      missingBodies,
      missingJoints,
      maxPositionDelta:max(bodies.map((body)=>body.positionDelta)),
      maxLinearVelocityDelta:max(bodies.map((body)=>body.linearVelocityDelta)),
      maxAngularVelocityDelta:max(bodies.map((body)=>body.angularVelocityDelta)),
      maxJointCoordinateDelta:max(joints.map((joint)=>joint.coordinateDelta)),
      sleepingMismatchCount:bodies.filter((body)=>body.presentLeft && body.presentRight && !body.sleepingEqual).length
    }
  };
}
