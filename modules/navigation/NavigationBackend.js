export class NavigationBackend {
  constructor(identity,{capabilities=[]}={}){
    this.identity=identity;
    this.capabilities=Object.freeze([...new Set(capabilities)]);
  }

  hasCapability(capability){ return this.capabilities.includes(capability); }
  profile(){ return {identity:this.identity,capabilities:[...this.capabilities]}; }
  isReady(){ return false; }

  async build(){ throw new Error(`${this.identity} navigation backend does not implement build()`); }
  syncObstacles(){ throw new Error(`${this.identity} navigation backend does not implement syncObstacles()`); }
  queryPath(){ throw new Error(`${this.identity} navigation backend does not implement queryPath()`); }
  debugGeometry(){ return []; }
  clear(){}
  dispose(){ this.clear(); }
}
