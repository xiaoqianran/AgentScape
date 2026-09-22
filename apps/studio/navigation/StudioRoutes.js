const PRODUCT_PAGES = new Set(['worlds','world','build','assets','agent']);
const GENERATED_SOURCE_KEYS = Object.freeze(['worldManifest','mesh','visual','semantics','up']);

const asUrl = (value) => new URL(value, globalThis.location?.origin || 'http://127.0.0.1');

export function parseStudioRoute(currentHref) {
  const url = asUrl(currentHref);
  const explicitPage = url.searchParams.get('page');
  const hasLegacyWorldSource = Boolean(
    url.searchParams.get('world') ||
    url.searchParams.get('worldManifest') ||
    url.searchParams.get('mesh')
  );
  const page = PRODUCT_PAGES.has(explicitPage)
    ? explicitPage
    : (hasLegacyWorldSource || url.searchParams.get('worldArtifact') || url.searchParams.get('authoring')
      ? 'world'
      : 'worlds');

  return Object.freeze({
    page,
    agentView:page === 'agent' && url.searchParams.get('agent') === 'runs' ? 'runs' : 'tasks',
    worldId:url.searchParams.get('world'),
    worldArtifactId:url.searchParams.get('worldArtifact'),
    authoringId:url.searchParams.get('authoring'),
    externalGenerated:Boolean(url.searchParams.get('worldManifest') || url.searchParams.get('mesh'))
  });
}

export function studioProductUrl(currentHref, { page = 'worlds', agentView = 'tasks' } = {}) {
  const url = asUrl(currentHref);
  const nextPage = PRODUCT_PAGES.has(page) ? page : 'worlds';
  url.searchParams.set('page', nextPage);
  if (nextPage === 'agent' && agentView === 'runs') url.searchParams.set('agent','runs');
  else url.searchParams.delete('agent');
  return url.toString();
}

export function builtInWorldUrl(currentHref, worldId) {
  const url = asUrl(currentHref);
  for (const key of [...GENERATED_SOURCE_KEYS,'worldArtifact','authoring']) url.searchParams.delete(key);
  url.searchParams.set('world',worldId);
  url.searchParams.set('page','world');
  url.searchParams.delete('agent');
  return url.toString();
}

export function generatedArtifactWorldUrl(currentHref, artifactId) {
  const url = asUrl(currentHref);
  for (const key of [...GENERATED_SOURCE_KEYS,'world','authoring']) url.searchParams.delete(key);
  url.searchParams.set('worldArtifact',artifactId);
  url.searchParams.set('page','world');
  url.searchParams.delete('agent');
  return url.toString();
}

export function authoringWorldUrl(currentHref, authoringId = null) {
  const url = asUrl(currentHref);
  for (const key of [...GENERATED_SOURCE_KEYS,'world','worldArtifact']) url.searchParams.delete(key);
  if (authoringId) url.searchParams.set('authoring',authoringId);
  else url.searchParams.delete('authoring');
  url.searchParams.set('page','world');
  url.searchParams.delete('agent');
  return url.toString();
}

export function isProductNavigationActive(activePage, navigationPage) {
  if (navigationPage === 'worlds') return activePage === 'worlds' || activePage === 'world';
  return activePage === navigationPage;
}
