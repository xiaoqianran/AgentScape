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
  queryRoute(){ throw new Error(`${this.identity} navigation backend does not implement queryRoute()`); }
  debugGeometry(){ return []; }
  clear(){}
  dispose(){ this.clear(); }
}
