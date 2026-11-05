// Studio orchestration only: compiler and isolated physical verification remain in AssetModule.
export class MechanicalAssetController {
  constructor({ assets, resources, placement, log = () => {} }) {
    if (!assets?.importMechanicalDraft || !resources?.approveAsset || !placement?.placeAtCenter) {
      throw new TypeError('MechanicalAssetController requires assets, resources and placement');
    }
    this.assets=assets;
    this.resources=resources;
    this.placement=placement;
    this.log=log;
    this.building=false;
  }

  async build(draft) {
    if(this.building)throw new Error('已有机械资产正在编译');
    this.building=true;
    try {
      const {manifest,admission}=await this.assets.importMechanicalDraft(draft);
      if(admission.status==='rejected')throw new Error('资产未通过准入，不能加入资产库');
      await this.resources.approveAsset(manifest.id,{label:draft.name});
      this.log('机械资产已创建：'+draft.name+' · '+admission.status,'result');
      return {assetId:manifest.id,manifest,admission};
    }finally{this.building=false;}
  }

  place(assetId) {return this.placement.placeAtCenter(assetId);}
}
