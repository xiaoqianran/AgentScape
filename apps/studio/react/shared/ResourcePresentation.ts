const labels:Record<string,string>={agent:'智能体',cabinet:'柜子',chair:'椅子',cup:'杯子',table:'桌子'};
const actions:Record<string,string>={move:'移动',navigate:'导航',open:'打开',close:'关闭',pickup:'拿取',drop:'释放',place:'放置'};
export const assetDisplayName=(id:string,label?:string)=>labels[id] || label || id;
export const assetPreview=(id:string)=>labels[id] ? '/previews/assets/'+id+'.webp' : null;
export const assetActions=(values:string[]=[])=>values.map(value=>actions[value] || value).join(' · ');
