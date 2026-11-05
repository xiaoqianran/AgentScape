import * as THREE from 'three';
import { serializeAsset, execute } from './AuthoringSandboxEntry.js';
self.onmessage = async ({ data }) => {
  let url;
  try {
    let document;
    if(data.mode === 'procedural') {
      url=URL.createObjectURL(new Blob([data.source],{type:'text/javascript'}));
      const module=await import(/* @vite-ignore */ url);
      if(typeof module.createAsset !== 'function')throw new Error('PROCEDURAL_ENTRY_REQUIRED');
      document=serializeAsset(await module.createAsset(THREE));
    } else document=execute(data.code,data.document);
    self.postMessage({document});
  }
  catch (error) { self.postMessage({ error:String(error.message).slice(0,500) }); }
  finally {if(url)URL.revokeObjectURL(url);}
};
