// Checks that the hosted registry serves a consistent registry.json and every item payload it references.
const BASE = "https://gridcn.vercel.app/r";

async function getJson(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const registry = await getJson("registry.json");
if (registry.name !== "gridcn") throw new Error(`registry.json: name is "${registry.name}", expected "gridcn"`);
if (!Array.isArray(registry.items) || registry.items.length === 0) throw new Error("registry.json: items missing or empty");

for (const item of registry.items) {
  const payload = await getJson(`${item.name}.json`);
  if (payload.name !== item.name) throw new Error(`${item.name}.json: payload name is "${payload.name}"`);
  if (payload.type !== item.type) throw new Error(`${item.name}.json: type mismatch (${payload.type} vs ${item.type})`);
  if (!Array.isArray(payload.files) || payload.files.length === 0) throw new Error(`${item.name}.json: files missing or empty`);
  for (const file of payload.files) {
    if (!file.path) throw new Error(`${item.name}.json: file without path`);
    if (typeof file.content !== "string" || file.content.length === 0) throw new Error(`${item.name}.json: ${file.path} has no content`);
  }
  console.log(`${item.name}: ok (${payload.files.length} files)`);
}

console.log(`hosted registry ok: ${registry.items.length} items at ${BASE}`);
