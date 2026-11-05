const parts = [];
const colliders = [];

function block(id, size, position, color, {solid = true} = {}) {
  parts.push({
    id,
    geometry:{type:'box',size},
    position,
    material:{color,roughness:0.84}
  });
  if(solid) colliders.push({
    shape:'box',
    halfExtents:size.map(value=>value/2),
    translation:position
  });
}

// Standalone modern single-story house with a real doorway, windows and a porch staircase.
// Coordinates are local to the house so the model can be positioned anywhere in the world.
const wall = '#e9ddca';
const trim = '#55453c';
const wood = '#a8794e';
const glass = '#79bbd5';
const roof = '#475466';

block('foundation',[5.6,0.4,5.0],[0,0.2,0],trim);
block('interior_floor',[5.2,0.15,4.6],[0,0.48,0],wood);
block('back_wall',[5.2,2.7,0.22],[0,1.9,-2.2],wall);

// Front wall with an actual open 1.3m doorway.
block('front_left',[1.95,2.7,0.22],[-1.625,1.9,2.2],wall);
block('front_right',[1.95,2.7,0.22],[1.625,1.9,2.2],wall);
block('door_lintel',[1.3,0.55,0.22],[0,2.975,2.2],wall);
block('door_frame_l',[0.10,2.18,0.32],[-0.70,1.64,2.2],trim);
block('door_frame_r',[0.10,2.18,0.32],[0.70,1.64,2.2],trim);

// Window openings are formed by four distinct wall sections.
for(const side of [-1,1]){
  const x=side*2.6;
  const label=side<0?'left':'right';
  block(label+'_lower',[0.22,0.9,4.4],[x,1.0,0],wall);
  block(label+'_upper',[0.22,0.8,4.4],[x,2.85,0],wall);
  block(label+'_window_front',[0.22,1.15,1.3],[x,2.05,1.55],wall);
  block(label+'_window_back',[0.22,1.15,1.3],[x,2.05,-1.55],wall);
  block(label+'_glass',[0.08,1.15,1.8],[x,2.05,0],glass);
  block(label+'_mullion',[0.12,1.2,0.07],[x,2.05,0],trim);
}
block('roof_slab',[6.0,0.24,5.5],[0,3.39,0],roof);
block('roof_front_fascia',[6.1,0.30,0.22],[0,3.42,2.70],trim);
block('roof_back_fascia',[6.1,0.30,0.22],[0,3.42,-2.70],trim);

// Front porch and four ascending steps.
block('porch',[2.2,0.16,0.95],[0,0.52,2.86],wood);
for (let i=0;i<3;i++) {
  const height=0.12*(3-i);
  block('step_'+(i+1),[1.8,height*2,0.45],[0,height,3.52+i*0.45],trim);
}
// Distinct accents make it recognizable from the editor camera.
block('front_lamp_l',[0.16,0.24,0.16],[-1.15,2.22,2.36],'#f6d68d',{solid:false});
block('front_lamp_r',[0.16,0.24,0.16],[1.15,2.22,2.36],'#f6d68d',{solid:false});

export const houseRecipe = Object.freeze({
  schema:'agentscape.asset-recipe',
  schemaVersion:1,
  id:'architecture/modern_house',
  parts,
  capabilities:{
    level:'physical',
    actions:[],
    physics:{
      body:'fixed',
      mass:100,
      friction:0.8,
      colliders
    }
  }
});