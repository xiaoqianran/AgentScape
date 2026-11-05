import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rolldown } from 'rolldown';
let cached;
export function sandboxBundle() {
 cached ||= (async()=>{
  const build=await rolldown({input:fileURLToPath(new URL('./AuthoringSandboxEntry.js',import.meta.url)),platform:'neutral'});
  let code;try{code=(await build.generate({format:'iife',name:'AuthoringSandbox'})).output[0].code;}finally{await build.close();}
  const runner=await readFile(new URL('./sandbox/run.mjs',import.meta.url),'utf8');
  return {code,runner,digest:createHash('sha256').update(code).update(runner).digest('hex')};
 })();return cached;
}
