// Refreshes src/lib/remotionKit/presets.json from the public Remotion Kit marketplace
// (https://remotion-kit.com/marketplace). The marketplace is a Convex app; its public
// `presets:listMarketplace` query returns every published preset with its parameter schema.
// The presets' Remotion source is not public, so Bhippi keeps the design spec (copy, palette,
// fonts, timing, format, preview links) and the AI rebuilds a preset with its own templates.
//
//   node scripts/import-remotion-kit.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEPLOYMENT = 'https://superb-oriole-955.convex.cloud';
const OUT = fileURLToPath(new URL('../src/lib/remotionKit/presets.json', import.meta.url));

const response = await fetch(`${DEPLOYMENT}/api/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: 'presets:listMarketplace', args: {}, format: 'json' }),
});
const body = await response.json();
if (body.status !== 'success') throw new Error(body.errorMessage ?? `HTTP ${response.status}`);

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (n) => Math.round(n * 100) / 100;

const seen = new Map();
const presets = body.value
  .filter((p) => p.isPublic !== false && p.status === 'published')
  .sort((a, b) => (b.voteScore ?? 0) - (a.voteScore ?? 0) || a.name.localeCompare(b.name))
  .map((p) => {
    let id = slug(p.name) || p._id;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    let schema = {};
    try { schema = JSON.parse(p.inputSchema || '{}'); } catch { /* keep empty */ }
    const params = Object.entries(schema).map(([key, s]) => {
      const out = { key, type: s.type, label: s.label };
      for (const field of ['default', 'options', 'min', 'max', 'group']) if (s[field] !== undefined && s[field] !== '') out[field] = s[field];
      return out;
    });
    return {
      id,
      name: p.name,
      author: p.author,
      category: p.category,
      description: p.description,
      tags: [...new Set((p.tags ?? []).map((t) => t.toLowerCase()))],
      width: p.width,
      height: p.height,
      fps: p.fps,
      seconds: round(p.durationInFrames / p.fps),
      params,
      ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}),
      ...(p.previewVideoUrl ? { previewVideoUrl: p.previewVideoUrl } : {}),
      ...(p.isPremium ? { premium: true } : {}),
      votes: p.voteScore ?? 0,
    };
  });

// One preset per line keeps the file small and its diffs readable.
const head = JSON.stringify({ source: 'https://remotion-kit.com/marketplace', fetched: new Date().toISOString().slice(0, 10) }).slice(0, -1);
writeFileSync(OUT, `${head},"presets":[\n${presets.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`);
console.log(`${presets.length} presets -> ${OUT}`);
