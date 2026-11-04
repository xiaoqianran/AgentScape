import { getQuickJS } from 'quickjs-emscripten';
import { readFile } from 'node:fs/promises';
const chunks=[];let size=0;
for await(const chunk of process.stdin) {size+=chunk.length;if(size>3145728)throw Error('SANDBOX_INPUT_LIMIT');chunks.push(chunk);}
const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const bundle=await readFile('/app/bundle.js','utf8');
const QuickJS=await getQuickJS();const runtime=QuickJS.newRuntime();
runtime.setMemoryLimit(96*1024*1024);runtime.setMaxStackSize(1024*1024);
const vm=runtime.newContext();let deadline=Date.now()+5000;
runtime.setInterruptHandler(()=>Date.now()>deadline);
try {
 const setup=vm.evalCode(bundle);if(setup.error){setup.error.dispose();throw Error('SANDBOX_INIT_FAILED');}setup.value.dispose();
 deadline=Date.now()+1500;
 const expression=request.mode==='procedural'
  ? `AuthoringSandbox.build(${JSON.stringify(request.source)})`
  : `AuthoringSandbox.execute(${JSON.stringify(request.code)},${JSON.stringify(request.document)})`;
 const result=vm.evalCode(`JSON.stringify(${expression})`);
 if(result.error){const error=vm.dump(result.error);result.error.dispose();throw Error(Date.now()>deadline?'BUILD_TIMEOUT':String(error?.message||'BUILD_EXECUTION_FAILED').slice(0,500));}
 const json=vm.getString(result.value);result.value.dispose();
 if(json.length>2097152)throw Error('BUILD_OUTPUT_LIMIT');
 process.stdout.write(JSON.stringify({document:JSON.parse(json)}));
} catch(error){process.stdout.write(JSON.stringify({error:String(error.message).slice(0,500)}));process.exitCode=1;}
finally {vm.dispose();runtime.dispose();}
