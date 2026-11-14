import { thermalDefinitionSchema,materialDefinitionSchema } from '../../../../foundation/simulation/SimulationProfile.js';
import type { z } from 'zod/v4';

type Material=z.infer<typeof materialDefinitionSchema>;
type Thermal=z.infer<typeof thermalDefinitionSchema>;
export type MaterialBody={material:Material;thermal:Thermal};

const numeric=(value:string)=>value.trim()===''?0:Number(value);

export function ThermalMaterialEditor({value,onEdit,label=''}:{
  value:MaterialBody;
  onEdit:(updater:(next:MaterialBody)=>void)=>void;
  label?:string;
}){
  const change=(updater:(next:MaterialBody)=>void)=>onEdit(updater);
  const title=(name:string)=>label?label+' · '+name:name;
  return <div className="mechanical-thermal-fields">
    <div className="mechanical-field-row">
      <label>材料名称<input aria-label={title('材料名称')} value={value.material.name}
        onChange={e=>change(s=>{s.material.name=e.target.value;})}/></label>
      <label>参数来源
        <select aria-label={title('参数来源')} value={value.material.provenance}
          onChange={e=>change(s=>{s.material.provenance=e.target.value as Material['provenance'];})}>
          <option value="authored">用户声明</option><option value="ai-estimated">AI 估计</option><option value="reference">参考资料</option>
        </select>
      </label>
      <label>密度 (kg/m³)<input aria-label={title('密度')} type="number" min=".001" step="10"
        value={value.material.densityKgM3} onChange={e=>change(s=>{s.material.densityKgM3=numeric(e.target.value);})}/></label>
      <label>比热容 (J/kg/K)<input aria-label={title('比热容')} type="number" min=".001" step="10"
        value={value.material.specificHeatJkgK} onChange={e=>change(s=>{s.material.specificHeatJkgK=numeric(e.target.value);})}/></label>
      <label>导热系数 (W/m/K)<input aria-label={title('导热系数')} type="number" min="0" step=".1"
        value={value.material.conductivityWmK??0}
        onChange={e=>change(s=>{s.material.conductivityWmK=numeric(e.target.value);})}/></label>
    </div>
    <div className="mechanical-field-row">
      <label>热学质量来源
        <select aria-label={title('热学质量来源')} value={value.thermal.mass.mode}
          onChange={e=>change(s=>{s.thermal.mass=e.target.value==='density-volume'
            ? {mode:'density-volume',volumeM3:.001}:{mode:'explicit',massKg:1};})}>
          <option value="explicit">显式质量</option><option value="density-volume">密度 × 实体体积</option>
        </select>
      </label>
      {value.thermal.mass.mode==='explicit'
        ?<label>热学质量 (kg)<input aria-label={title('热学质量')} type="number" min=".001" step=".1"
          value={value.thermal.mass.massKg}
          onChange={e=>change(s=>{if(s.thermal.mass.mode==='explicit')s.thermal.mass.massKg=numeric(e.target.value);})}/></label>
        :<label>有效实体体积 (m³)<input aria-label={title('有效实体体积')} type="number" min=".000001" step=".001"
          value={value.thermal.mass.volumeM3}
          onChange={e=>change(s=>{if(s.thermal.mass.mode==='density-volume')s.thermal.mass.volumeM3=numeric(e.target.value);})}/></label>}
      <label>初始温度 (K)<input aria-label={title('初始温度')} type="number" min="0" step="1"
        value={value.thermal.initialTemperatureK}
        onChange={e=>change(s=>{s.thermal.initialTemperatureK=numeric(e.target.value);})}/></label>
      <label>外部热功率 (W)<input aria-label={title('外部热功率')} type="number" step="10"
        value={value.thermal.heatPowerW}
        onChange={e=>change(s=>{s.thermal.heatPowerW=numeric(e.target.value);})}/></label>
    </div>
    <div className="mechanical-field-row">
      <label>环境温度 (K)<input aria-label={title('环境温度')} type="number" min="0" step="1"
        value={value.thermal.ambientTemperatureK}
        onChange={e=>change(s=>{s.thermal.ambientTemperatureK=numeric(e.target.value);})}/></label>
      <label>环境换热 (W/K)<input aria-label={title('环境换热')} type="number" min="0" step=".1"
        value={value.thermal.ambientConductanceWPerK}
        onChange={e=>change(s=>{s.thermal.ambientConductanceWPerK=numeric(e.target.value);})}/></label>
      <label>物理接触换热 (W/K)<input aria-label={title('接触换热')} type="number" min="0" step=".1"
        value={value.thermal.contactConductanceWPerK}
        onChange={e=>change(s=>{s.thermal.contactConductanceWPerK=numeric(e.target.value);})}/></label>
    </div>
    <p>材料密度与有效实体体积可用于计算热容；物理接触必须由物理引擎确认。
      材料导热系数是元数据，内部热链路与接触换热系数是单独声明的模型参数。</p>
  </div>;
}
