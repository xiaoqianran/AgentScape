import type { CodeExecutionOptions } from './index.js';
export declare function startServer(options:{tokens:Array<{identity:string;token:string}>;port?:number;root?:string;dataRoot?:string;codeExecution?:CodeExecutionOptions;studioOrigins?:string[]}):Promise<{port:number;close():Promise<void>}>;
