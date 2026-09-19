export function builtInWorldUrl(currentHref, worldId) {
  const url = new URL(currentHref);
  for (const key of ['worldManifest','mesh','visual','semantics','up']) url.searchParams.delete(key);
  url.searchParams.set('world',worldId);
  return url.toString();
}

export const STUDIO_NAVIGATION = Object.freeze([
  { view:'world', label:'World', group:'primary' },
  { view:'create', label:'Create', group:'primary' },
  { view:'task', label:'Agent', group:'primary' },
  { view:'resources', label:'Library', group:'utility' },
  { view:'inspect', label:'Inspect', group:'utility' },
  { view:'runs', label:'Runs', group:'utility' }
]);

const PRIMARY_CONTEXTS = new Map([
  ['create','create'],
  ['task','agent']
]);

export function workspaceForStudioView(currentWorkspace,view) {
  if (view === 'world') return 'world';
  return PRIMARY_CONTEXTS.get(view) || currentWorkspace;
}
