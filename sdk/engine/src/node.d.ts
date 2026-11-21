export * from './index.js';
import type { CodeExecutionOptions } from './index.js';
export interface CodeExecutor {
  environment():Promise<Record<string,unknown>>;
  run(request:{mode:'procedural';source:string}|{mode:'authoring';code:string;document:unknown},options?:{signal?:AbortSignal}):Promise<{document:unknown;environment:Record<string,unknown>;security:Record<string,unknown>}>;
  execute(request:{code:string;document:unknown},options?:{signal?:AbortSignal}):Promise<unknown>;
  close():void;
}
export declare function createCodeExecutor(options?:CodeExecutionOptions):CodeExecutor;

export declare class WorldDiskStorage {
  constructor(directory:string);
  initialize():Promise<WorldDiskStorage>;
  read(hash:string,expectedBytes:number):Promise<Uint8Array>;
  write(hash:string,bytes:Uint8Array):Promise<void>;
}
