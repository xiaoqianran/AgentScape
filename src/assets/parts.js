export const ROOT_PART = '$root';

export function orderParts(parts = {}) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (name) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Part hierarchy cycle: ${name}`);
    const part = parts[name];
    if (!part) throw new Error(`Unknown part: ${name}`);
    visiting.add(name);
    const parent = part.parent || ROOT_PART;
    if (parent !== ROOT_PART) {
      if (!parts[parent]) throw new Error(`Unknown parent part: ${parent}`);
      if (parent === name) throw new Error(`Part cannot parent itself: ${name}`);
      visit(parent);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push([name, part]);
  };

  Object.keys(parts).forEach(visit);
  return ordered;
}
