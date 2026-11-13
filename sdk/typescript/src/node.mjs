import { AgentScape as BrowserAgentScape } from './index.js';
import { createCodeExecutor } from './runtime/apps/mcp-server/CodeExecutor.js';
import { installHeadlessAssetIO } from './runtime/apps/mcp-server/HeadlessAssetIO.js';
import { createHeadlessGLTFLoader } from './runtime/apps/mcp-server/HeadlessGLTFLoader.js';
import { createAssetModule } from './runtime/modules/asset/AssetModule.js';
export * from './index.js';
export { createCodeExecutor };
export { WorldDiskStorage } from './runtime/apps/server/WorldDiskStorage.js';
export async function openCodeProject(options = {}) {
  installHeadlessAssetIO();
  return BrowserAgentScape.openProject({ ...options,
    assetModule: createAssetModule({ volatile:true, manifestStore:null, libraryStore:null, gltfLoader:createHeadlessGLTFLoader() }) });
}
export const AgentScape = {
  attach: BrowserAgentScape.attach,
  openProject: openCodeProject,
  async open(options = {}) {
    installHeadlessAssetIO();
    const executor = createCodeExecutor(options.codeExecution || { mode:'disabled' });
    const loader = createHeadlessGLTFLoader();
    try { return await BrowserAgentScape.open({...options,codeExecutor:executor,codeGLTFLoader:loader,
      assetModule:createAssetModule({volatile:true,manifestStore:null,libraryStore:null,gltfLoader:loader})}); }
    catch(error) { executor.close(); throw error; }
  }
};
