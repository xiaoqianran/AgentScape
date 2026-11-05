import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

// No host functions, module loader, filesystem, network or credentials are exposed to QuickJS.
const { bundle, code, source, mode='authoring', document, timeoutMs, memoryBytes }=workerData;
const QuickJS=await getQuickJS();
const runtime=QuickJS.newRuntime();
runtime.setMemoryLimit(memoryBytes);
runtime.setMaxStackSize(1024*1024);
const context=runtime.newContext();
let deadline=Date.now()+5000;
runtime.setInterruptHandler(()=>Date.now()>deadline);
try {
 const setup=context.evalCode(bundle,'trusted-authoring-bootstrap.js');
 if (setup.error) { setup.error.dispose(); throw new Error('AUTHORING_SANDBOX_INIT_FAILED'); }
 setup.value.dispose();
 deadline=Date.now()+timeoutMs;
 const expression=mode==='procedural' ? `AuthoringSandbox.build(${JSON.stringify(source)})` : `AuthoringSandbox.execute(${JSON.stringify(code)},${JSON.stringify(document)})`;
 const output=context.evalCode(`JSON.stringify(${expression})`,'agent-authoring.js');
 if (output.error) {
  const error=context.dump(output.error); output.error.dispose();
  const message=Date.now()>deadline?'AUTHORING_CODE_TIMEOUT':String(error?.message || 'AUTHORING_CODE_FAILED').slice(0,500);
  parentPort.postMessage({error:message});
 } else {
  const json=context.getString(output.value); output.value.dispose();
  if (json.length>2097152) throw new Error('AUTHORING_DOCUMENT_LIMIT');
  parentPort.postMessage({json});
 }
} catch(error) { parentPort.postMessage({error:String(error.message).slice(0,500)}); }
finally { context.dispose(); runtime.dispose(); }
