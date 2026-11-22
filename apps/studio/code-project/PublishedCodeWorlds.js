/**
 * Curated, same-origin code projects. The catalogue is not the browser's IndexedDB.
 * A visitor explicitly opens an example before Studio imports/runs its trusted code.
 */
export const PUBLISHED_CODE_WORLDS = Object.freeze([
  Object.freeze({
    slug:'eldermere-academy',
    id:'world_2a1218753a07458db1cb39784010081f',
    name:'艾德米尔魔法学院 · Eldermere Academy',
    description:'哥特式魔法学院城堡、尖塔、石桥、湖泊、森林和可交互魔法灯光。',
    projectUrl:'/code-projects/eldermere-academy.json',
    previewUrl:'/examples/eldermere-academy/'
  })
]);

export const findPublishedCodeWorld = slug => PUBLISHED_CODE_WORLDS.find(world=>world.slug===slug) || null;
