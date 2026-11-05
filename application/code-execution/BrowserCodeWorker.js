import { build, execute } from './AuthoringSandboxEntry.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ document:data.mode === 'procedural' ? build(data.source) : execute(data.code, data.document) }); }
  catch (error) { self.postMessage({ error:String(error.message).slice(0,500) }); }
};
