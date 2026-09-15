// Canvas drawing is deliberately stubbed: these tests exercise migrated geometry,
// callbacks and simulation, not browser rendering or visual fidelity.
export function cabinCanvasHost() {
  const elements = new Map();
  const context = new Proxy({
    measureText:text=>({width:String(text).length*8}),
    createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}}),
    getImageData:()=>({data:new Uint8ClampedArray(256*256*4)}),
    setLineDash(){},
  }, {get:(target,key)=>target[key] ?? (()=>{}),set:(target,key,value)=>{target[key]=value;return true;}});
  const element = () => ({
    width:256,height:256,value:'',style:{},dataset:{},
    classList:{add(){},remove(){}},
    listeners:new Map(),
    addEventListener(name,callback){this.listeners.set(name,callback);},
    getContext:()=>context,
    focus(){},select(){},blur(){},
  });
  const host = {querySelector(selector){if(!elements.has(selector)) elements.set(selector,element());return elements.get(selector);}};
  return {editorHost:host,document:{createElement:element},elements};
}
