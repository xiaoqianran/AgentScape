export const workspace = {
  name: "xiaoqianran's Workspace",
  avatar: "X",
  user: "xiaoqianran",
};

export const recents = [
  { id: "f1", name: "Mini Room - Art - Copy", time: "1 day ago", art: "mini-room" },
  { id: "f2", name: "Spline 3D Starter File", time: "1 day ago", art: "starter" },
  { id: "f3", name: "Untitled", time: "1 day ago", art: "empty" },
  { id: "f4", name: "Hana starter file", time: "3 days ago", art: "hana" },
  { id: "f5", name: "Hana starter file", time: "3 days ago", art: "hana-light" },
  { id: "f6", name: "Hana starter file", time: "3 days ago", art: "empty" },
  { id: "f7", name: "Untitled", time: "3 days ago", art: "empty" },
];

export const examples = [
  "A cute 3D robot character",
  "An isometric low-poly room",
  "A glossy glass orb",
];

export const modeOptions = [
  { id: "scene", label: "3D Scene", description: "Interactive 3D objects and scenes" },
  { id: "design", label: "Design", description: "2D vectors, UI, and layouts" },
  { id: "generate", label: "Generate", description: "AI images and starter assets" },
];

/** Quality tiers scraped from app.spline.design/home */
export const qualityOptions = [
  { id: "fast", label: "Fast", description: "Huge speed at less detail", model: "Gemini 3.8 Flash" },
  { id: "basic", label: "Basic", description: "Good quality with medium speed", model: "Gemini 3.1 Pro" },
  { id: "luna", label: "Luna", description: "Light and inexpensive", model: "GPT-5.6 Luna" },
  { id: "medium", label: "Medium", description: "Balanced quality and speed", model: "Claude Sonnet 5" },
  { id: "high", label: "High", description: "Solid quality at mid cost", model: "GPT-5.6 Terra" },
  { id: "max", label: "Max", description: "High quality but slow", model: "GPT-5.5" },
  { id: "max-pro", label: "Max Pro", description: "High quality but slow", model: "GPT-5.6 Sol" },
  { id: "ultra", label: "Ultra", description: "Superior quality but slow", model: "Claude Opus 5" },
  { id: "ultra-max", label: "Ultra Max", description: "Best quality, highest cost", model: "Claude Fable 5.1" },
];

export const effortOptions = [
  { id: "low", label: "Low", description: "Light thinking" },
  { id: "medium", label: "Medium", description: "Balanced speed / quality" },
  { id: "high", label: "High", description: "More thorough" },
  { id: "max", label: "Max", description: "Maximum reasoning" },
];

export const routeTitles = {
  home: "Home",
  files: "My files",
  templates: "Templates",
  community: "Community",
  academy: "Academy",
  generate: "Generate",
  scene: "Spline 3D Starter File",
  sceneFile: "Spline 3D Starter File",
  design: "Hana starter file",
  designFile: "Hana starter file",
};

/** Generate studio tabs (app.spline.design/generate) */
export const generateNav = [
  { id: "discover", label: "Discover" },
  { id: "3d", label: "3D Generate" },
  { id: "image", label: "Image Generate" },
  { id: "assets", label: "Assets" },
  { id: "settings", label: "Settings" },
];

export const generateCategories = [
  "All",
  "Characters",
  "Furniture",
  "Architecture",
  "Props",
  "Objects",
  "Creatures",
  "Vehicles",
  "Nature",
  "Food & drink",
];

export const outputTypeOptions = [
  { id: "3d-model", label: "3D model", description: "Mesh you can place in a scene" },
  { id: "image", label: "Image", description: "2D concept or texture" },
  { id: "material", label: "Material", description: "PBR texture set" },
];

export const modelEngineOptions = [
  { id: "hunyuan3d", label: "Hunyuan3D", description: "High fidelity mesh" },
  { id: "tripo", label: "Tripo", description: "Fast draft mesh" },
  { id: "meshy", label: "Meshy", description: "Stylized + textured" },
];

export const importAccept = "image/png, image/jpeg, image/jpg, image/webp, image/gif";

/** Discover gallery seed cards (short stand-ins for long real prompts) */
export const discoverCards = [
  { id: "d1", category: "Characters", title: "Meditative athlete", prompt: "A female figure with long, wavy silver-gray hair seated cross-legged in soft taupe athletic wear." },
  { id: "d2", category: "Furniture", title: "Lounge chair, walnut + leather", prompt: "A mid-century modern lounge chair with stacked cushions, walnut plywood shell, and four-legged swivel base." },
  { id: "d3", category: "Furniture", title: "Cognac lounge chair", prompt: "A mid-century lounge chair in warm cognac leather with button-tufting and a dark walnut frame." },
  { id: "d4", category: "Furniture", title: "Sculpted wood lounge", prompt: "A modern lounge chair with a curved walnut shell, beige quilted linen, and black star base." },
  { id: "d5", category: "Architecture", title: "Five-story apartment", prompt: "A contemporary residential building with white facade, dark-framed windows, wood balconies, and rooftop garden." },
  { id: "d6", category: "Architecture", title: "Curved timber pavilion", prompt: "A pavilion with a dramatic curved slatted wooden roof on a raised wood platform." },
  { id: "d7", category: "Architecture", title: "Tiny house", prompt: "A compact modernist tiny house with gable roof, wood siding, and glass front door." },
  { id: "d8", category: "Furniture", title: "Sage modular sofa", prompt: "A modular sectional sofa in sage green linen with cubic proportions and matching pillows." },
  { id: "d9", category: "Props", title: "Ribbed ceramic lamp", prompt: "A table lamp with sage ribbed ceramic base, brass pedestal, and cream linen drum shade." },
  { id: "d10", category: "Architecture", title: "Marble pavilion", prompt: "A classical pavilion with cream marble Corinthian colonnade and terracotta tile roof." },
  { id: "d11", category: "Creatures", title: "Spotted deer", prompt: "A stylized male deer with reddish-brown coat, white spots, and branching antlers." },
  { id: "d12", category: "Creatures", title: "Terracotta octopus", prompt: "A stylized octopus sculpture in warm terracotta with suction-cup tentacles and spiral tips." },
  { id: "d13", category: "Objects", title: "Studio headphones", prompt: "A modern over-ear headphone with gray and black finish and fabric mesh accents." },
  { id: "d14", category: "Nature", title: "Iridescent jellyfish", prompt: "A translucent jellyfish with iridescent purple-pink bell and trailing pale tentacles." },
  { id: "d15", category: "Creatures", title: "Red fox", prompt: "A red fox in profile with cream chest, black-tipped ears, and fluffy white-tipped tail." },
  { id: "d16", category: "Vehicles", title: "Mint retro scooter", prompt: "A vintage electric scooter in mint green with cream accents and brown leather seat." },
  { id: "d17", category: "Props", title: "Walnut desk organizer", prompt: "A matte black desk organizer with sticky-note tray, walnut pen cup, scissors and pens." },
  { id: "d18", category: "Food & drink", title: "Story teapot", prompt: "A stylized anthropomorphic teapot with cream body, sage glaze panel, and leather pouch." },
];

export function paintThumb(canvas, kind) {
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = 88);
  const h = (canvas.height = 56);
  ctx.clearRect(0, 0, w, h);

  const fill = (c) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
  };

  switch (kind) {
    case "mini-room": {
      fill("#c9a0d8");
      ctx.fillStyle = "#f0d4e8";
      ctx.fillRect(8, 28, 72, 22);
      ctx.fillStyle = "#8b5a9e";
      ctx.fillRect(28, 14, 32, 28);
      ctx.fillStyle = "#f5c842";
      ctx.beginPath();
      ctx.arc(44, 22, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e87a9a";
      ctx.fillRect(14, 18, 10, 10);
      break;
    }
    case "starter": {
      fill("#1a1a22");
      ctx.fillStyle = "#5ad0ff";
      ctx.beginPath();
      ctx.arc(30, 28, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff6bcb";
      ctx.beginPath();
      ctx.arc(52, 24, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9b8cff";
      ctx.beginPath();
      ctx.arc(62, 36, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "hana": {
      fill("#f4f4f4");
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(10, 10, 28, 36);
      ctx.strokeRect(48, 10, 28, 36);
      ctx.fillStyle = "#222";
      ctx.fillRect(16, 38, 16, 3);
      ctx.fillRect(54, 38, 16, 3);
      break;
    }
    case "hana-light": {
      fill("#ececec");
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(12, 12, 24, 32);
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.arc(58, 28, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      fill("#292929");
  }
}
