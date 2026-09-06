export async function replaceStudioEnvironment(world,nextEnvironment,{reason='resource-library'}={}) {
  if(!world?.snapshot||!world?.clearObjects||!world?.replaceEnvironment) throw new TypeError('replaceStudioEnvironment requires WorldRuntime');
  if(!nextEnvironment) throw new TypeError('replaceStudioEnvironment requires nextEnvironment');

  const sceneBefore=world.snapshot();
  const previous=world.environment;
  const objectCount=world.store?.list?.().length ?? 0;

  try {
    await world.clearObjects({silent:true});
    await world.replaceEnvironment(nextEnvironment,{disposePrevious:false,reason});
  } catch (error) {
    try {
      if(world.environment===previous) await world.restore(sceneBefore);
    } catch (rollbackError) {
      const failure=new AggregateError([error,rollbackError],'Studio environment replacement rollback failed',{cause:error});
      failure.code='STUDIO_ENVIRONMENT_REPLACE_ROLLBACK_FAILED';
      failure.rollbackError=rollbackError;
      throw failure;
    }
    nextEnvironment?.dispose?.();
    throw error;
  }

  let disposeError=null;
  try { previous?.dispose?.(); }
  catch (error) { disposeError=error; }
  world.history?.clear?.();
  world.events?.emit?.('scene.cleared',{count:objectCount,reason});
  return {
    status:'world-opened',
    environmentId:nextEnvironment.id || null,
    previousEnvironmentId:previous?.id || null,
    clearedObjects:objectCount,
    ...(disposeError?{warning:{code:'PREVIOUS_ENVIRONMENT_DISPOSE_FAILED',message:disposeError.message}}:{})
  };
}
