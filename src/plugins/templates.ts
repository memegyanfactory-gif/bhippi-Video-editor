// What a new plugin starts from in the Plugin Maker (plugin_scaffold), and the reviewed examples
// the AI can study (plugin_examples). Every one follows the rules plugin_validate checks: a spec
// with acceptance checks, code that waits for bhippi.ready, catches every call and shows the error,
// the editor's theme variables, no remote scripts, and the smallest permissions.

import type { PluginPermissions } from './types';

export type DraftFiles = Record<string, string>;
export type TemplateId = 'panel' | 'background' | 'action' | 'panel-actions';
export const TEMPLATES: TemplateId[] = ['panel', 'background', 'action', 'panel-actions'];

type Meta = { name: string; description: string; icon: string };

export type DraftManifest = {
  name: string;
  description: string;
  icon?: string;
  permissions: PluginPermissions;
  background: boolean;
  showAsPanel: boolean;
};

const manifest = (meta: Meta, change: Partial<DraftManifest> = {}): string =>
  `${JSON.stringify({ name: meta.name, description: meta.description, icon: meta.icon, permissions: { tools: [], network: [], chat: false, services: [] }, background: false, showAsPanel: true, ...change }, null, 2)}\n`;

const spec = (meta: Meta, kind: string) => `# ${meta.name}

## What it does
${meta.description || 'TODO: two to four lines on what the plugin does and for whom.'}
(${kind})

## UI
- TODO: the parts of the panel.

## Bhippi tools it calls
- TODO: each tool, and why. Reads (get_comp …) need no permission.

## Permissions
- tools: none yet
- network: none
- chat: no

## Acceptance checks
- TODO: 2–5 things that must be true. Each one is a bhippi.test() in app.js.
`;

const STYLE = `/* The editor's look: its CSS variables arrive with bhippi.ready. */
body { margin: 0; background: var(--panel); color: var(--text); font: 12px/1.45 var(--font, system-ui, sans-serif); }
.app { display: flex; flex-direction: column; gap: 8px; padding: 10px; min-width: 0; }
.bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
.bar strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dim { color: var(--text-dim); }
.empty { color: var(--text-faint); margin: 12px 0; text-align: center; }
.error { margin: 0; padding: 6px 8px; border-radius: var(--radius, 4px); background: var(--red-soft, rgba(220, 60, 60, 0.15)); color: var(--red, #e5484d); }
.list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.row { display: flex; gap: 8px; align-items: center; padding: 5px 6px; border-radius: var(--radius, 4px); border: 1px solid transparent; cursor: pointer; min-width: 0; }
.row:hover { background: var(--panel-3); border-color: var(--line); }
.row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .grow { flex: 1; min-width: 0; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
`;

const COMMON_JS = `const $ = (id) => document.getElementById(id);

/** Shows what went wrong in the panel (a refused call says why), and clears it again. */
function showError(error) {
  const box = $('error');
  box.textContent = error && error.message ? error.message : String(error);
  box.hidden = false;
}
function clearError() {
  $('error').hidden = true;
}

/** Runs fn at most once per wait, after the last call: project events come in bursts. */
function debounce(fn, wait) {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}
`;

const PAGE = (body: string) => `<link rel="stylesheet" href="style.css">
<div class="app">
${body}
  <p id="error" class="error" hidden></p>
</div>
<script src="app.js"></script>
`;

function panel(meta: Meta): DraftFiles {
  return {
    'manifest.json': manifest(meta),
    'spec.md': spec(meta, 'A panel.'),
    'index.html': PAGE(`  <header class="bar"><strong id="title">${meta.name}</strong><span id="status" class="dim"></span></header>
  <main id="content"><p class="empty">Loading…</p></main>`),
    'app.js': `${COMMON_JS}
async function render() {
  try {
    const comp = await bhippi.comp();
    clearError();
    $('status').textContent = comp.clips.length + ' clips';
    $('content').innerHTML = comp.clips.length ? '' : '<p class="empty">The timeline is empty.</p>';
    // TODO: draw the panel from comp.
  } catch (error) {
    showError(error);
  }
}

bhippi.ready.then(() => {
  render();
  bhippi.on('project', debounce(render, 200));
});

bhippi.test('reads the active comp', async () => {
  const comp = await bhippi.comp();
  if (!comp || !Array.isArray(comp.clips)) throw new Error('bhippi.comp() did not return the clips');
});
`,
    'style.css': STYLE,
  };
}

function background(meta: Meta): DraftFiles {
  return {
    'manifest.json': manifest(meta, { background: true }),
    'spec.md': spec(meta, 'A background automation: it keeps running with no panel open; its panel shows what it did.'),
    'index.html': PAGE(`  <header class="bar"><strong>${meta.name}</strong><span id="status" class="dim">watching</span></header>
  <ol id="log" class="list"><li class="empty">Nothing done yet.</li></ol>`),
    'app.js': `${COMMON_JS}
/** What the automation did, newest first, for the panel. */
function note(text) {
  const log = $('log');
  if (log.querySelector('.empty')) log.innerHTML = '';
  const item = document.createElement('li');
  item.className = 'row';
  item.textContent = new Date().toLocaleTimeString() + '  ' + text;
  log.prepend(item);
  while (log.children.length > 50) log.lastChild.remove();
}

async function check() {
  try {
    const comp = await bhippi.comp();
    clearError();
    // TODO: decide whether something needs doing, then do it with bhippi.tool() and note() it.
    $('status').textContent = comp.clips.length + ' clips watched';
  } catch (error) {
    showError(error);
  }
}

bhippi.ready.then(() => {
  check();
  bhippi.on('project', debounce(check, 400));
});

bhippi.test('can read the project it watches', async () => {
  const comp = await bhippi.comp();
  if (!Array.isArray(comp.clips)) throw new Error('no clips list');
});
`,
    'style.css': STYLE,
  };
}

function action(meta: Meta): DraftFiles {
  return {
    'manifest.json': manifest(meta, { background: true, showAsPanel: false }),
    'spec.md': spec(meta, 'An action Bhippi AI can call (bhippi.expose); it runs in the background with no panel.'),
    'index.html': PAGE(`  <header class="bar"><strong>${meta.name}</strong><span class="dim">offers Bhippi AI an action</span></header>`),
    'app.js': `${COMMON_JS}
/** The action's work, kept apart so the acceptance check can call it directly. */
async function summarize(args) {
  const comp = await bhippi.comp(args.compId);
  // TODO: the action's real work.
  return { comp: comp.name, clips: comp.clips.length, seconds: comp.duration };
}

bhippi.ready.then(() =>
  bhippi.expose('summarize', {
    description: 'TODO: what the action does, for Bhippi AI.',
    params: { type: 'object', properties: { compId: { type: 'string' } } },
  }, summarize).catch(showError));

bhippi.test('the action answers', async () => {
  const result = await summarize({});
  if (typeof result.clips !== 'number') throw new Error('no clip count');
});
`,
    'style.css': STYLE,
  };
}

function panelActions(meta: Meta): DraftFiles {
  const files = panel(meta);
  files['spec.md'] = spec(meta, 'A panel that also offers Bhippi AI actions (bhippi.expose).');
  files['app.js'] = files['app.js'].replace(
    "bhippi.ready.then(() => {\n  render();",
    `/** An action Bhippi AI can call while the panel runs. */
async function summarize() {
  const comp = await bhippi.comp();
  return { clips: comp.clips.length, seconds: comp.duration };
}

bhippi.ready.then(() => {
  bhippi.expose('summarize', { description: 'TODO: what it does, for Bhippi AI.', params: { type: 'object', properties: {} } }, summarize).catch(showError);
  render();`,
  );
  return files;
}

/** A new plugin's draft from a template. */
export function scaffold(template: TemplateId, meta: Meta): DraftFiles {
  switch (template) {
    case 'background':
      return background(meta);
    case 'action':
      return action(meta);
    case 'panel-actions':
      return panelActions(meta);
    default:
      return panel(meta);
  }
}

// ---------------------------------------------------------------------------------------------
// Reviewed examples (plugin_examples)

type Example = { id: string; title: string; about: string; files: DraftFiles };

const shotList: Example = {
  id: 'shot-list',
  title: 'Shot list',
  about: 'A panel: every clip of the active comp in time order; a click selects the clip and moves the playhead to it. Reads only, so no permissions. Shows debounced project sync and the empty/error states.',
  files: {
    'manifest.json': manifest({ name: 'Shot list', description: 'Every clip of the active comp in timeline order. Click one to select it and jump to it.', icon: '🎬' }),
    'spec.md': `# Shot list

## What it does
Lists every clip of the active comp in timeline order, with its track, start and length. Clicking a
row selects that clip and moves the playhead to its start. Stays in sync as the project changes.

## UI
- A header with the comp name and the clip count.
- One row per clip: track, name, start, duration. The selected clips are highlighted.
- Empty state for an empty timeline; error line when a call fails.

## Bhippi tools it calls
- none: bhippi.comp(), bhippi.selection and bhippi.playhead are reads and navigation.

## Permissions
- tools: none · network: none · chat: no

## Acceptance checks
- It reads the active comp and gets a clips list.
- Its rows are one per clip, in start order.
`,
    'index.html': PAGE(`  <header class="bar"><strong id="title">Shot list</strong><span id="status" class="dim"></span></header>
  <main id="rows" class="list"><p class="empty">Loading…</p></main>`),
    'app.js': `${COMMON_JS}
const time = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + '.' + String(Math.round((s % 1) * 10));
let selected = [];

function rowsFor(clips) {
  return [...clips].sort((a, b) => a.start - b.start);
}

async function render() {
  try {
    const comp = await bhippi.comp();
    clearError();
    $('title').textContent = comp.name;
    $('status').textContent = comp.clips.length + ' clips';
    const rows = $('rows');
    rows.innerHTML = '';
    if (!comp.clips.length) {
      rows.innerHTML = '<p class="empty">The timeline is empty.</p>';
      return;
    }
    for (const clip of rowsFor(comp.clips)) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.background = selected.includes(clip.id) ? 'var(--blue-soft)' : '';
      row.innerHTML = '<span class="dim"></span><span class="grow"></span><span class="dim"></span>';
      row.children[0].textContent = clip.track;
      row.children[1].textContent = clip.name;
      row.children[2].textContent = time(clip.start) + ' · ' + clip.duration.toFixed(1) + 's';
      row.onclick = async () => {
        try {
          await bhippi.selection.set([clip.id]);
          await bhippi.playhead.seek(clip.start);
        } catch (error) {
          showError(error);
        }
      };
      rows.append(row);
    }
  } catch (error) {
    showError(error);
  }
}

bhippi.ready.then(async () => {
  selected = await bhippi.selection.get().catch(() => []);
  render();
  bhippi.on('project', debounce(render, 200));
  bhippi.on('selection', (ids) => { selected = ids; render(); });
});

bhippi.test('reads the active comp', async () => {
  const comp = await bhippi.comp();
  if (!Array.isArray(comp.clips)) throw new Error('no clips list');
});
bhippi.test('one row per clip, in start order', async () => {
  const comp = await bhippi.comp();
  const ordered = rowsFor(comp.clips);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].start < ordered[i - 1].start) throw new Error('rows out of order');
  await render();
  const rows = document.querySelectorAll('#rows .row').length;
  if (rows !== comp.clips.length) throw new Error(rows + ' rows for ' + comp.clips.length + ' clips');
});
`,
    'style.css': STYLE,
  },
};

const markerHere: Example = {
  id: 'marker-here',
  title: 'Marker here',
  about: 'A panel that changes the project: one named tool (add_marker) in permissions, a text field, and the refusal shown when the permission mode says no. Its acceptance check really adds a marker — on the scratch copy plugin_test runs against.',
  files: {
    'manifest.json': manifest({ name: 'Marker here', description: 'Adds a named marker at the playhead.', icon: '📍' }, { permissions: { tools: ['add_marker'], network: [], chat: false } }),
    'spec.md': `# Marker here

## What it does
Adds a marker at the playhead with the name typed in the field. Lists the comp's markers.

## UI
- A name field and an Add button (Enter adds too).
- The comp's markers, newest time last. Empty and error states.

## Bhippi tools it calls
- add_marker { time, name }: the only change it makes.

## Permissions
- tools: add_marker · network: none · chat: no

## Acceptance checks
- Adding a marker puts one more marker on the comp, with that name.
`,
    'index.html': PAGE(`  <header class="bar"><strong>Marker here</strong></header>
  <form id="form" class="bar"><input id="name" class="grow" placeholder="Marker name" maxlength="80"><button class="primary">Add</button></form>
  <ol id="markers" class="list"></ol>`),
    'app.js': `${COMMON_JS}
async function addMarker(name) {
  const time = await bhippi.playhead.get();
  await bhippi.tool('add_marker', { time, name: name || 'Marker' });
}

async function render() {
  try {
    const comp = await bhippi.comp();
    clearError();
    const list = $('markers');
    list.innerHTML = comp.markers.length ? '' : '<li class="empty">No markers yet.</li>';
    for (const marker of comp.markers) {
      const item = document.createElement('li');
      item.className = 'row';
      item.textContent = marker.time.toFixed(2) + 's  ' + (marker.name || '');
      item.onclick = () => bhippi.playhead.seek(marker.time).catch(showError);
      list.append(item);
    }
  } catch (error) {
    showError(error);
  }
}

$('form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await addMarker($('name').value.trim());
    $('name').value = '';
  } catch (error) {
    showError(error);
  }
};

bhippi.ready.then(() => {
  render();
  bhippi.on('project', debounce(render, 150));
});

bhippi.test('adds a named marker', async () => {
  const before = (await bhippi.comp()).markers.length;
  await addMarker('Test marker');
  const after = await bhippi.comp();
  if (after.markers.length !== before + 1) throw new Error('no marker was added');
  if (!after.markers.some((m) => m.name === 'Test marker')) throw new Error('the marker lost its name');
});
`,
    'style.css': `${STYLE}input.grow { flex: 1; min-width: 0; }\n`,
  },
};

const clipCounter: Example = {
  id: 'clip-counter',
  title: 'Clip counter (action)',
  about: 'An action for Bhippi AI with no panel: bhippi.expose with a params schema, running in the background. The acceptance check calls the action function directly.',
  files: action({ name: 'Clip counter', description: 'Tells Bhippi AI how many clips of each kind the comp has.', icon: '🔢' }),
};
clipCounter.files['app.js'] = `${COMMON_JS}
async function countClips(args) {
  const comp = await bhippi.comp(args && args.compId);
  const byKind = {};
  for (const clip of comp.clips) byKind[clip.kind] = (byKind[clip.kind] || 0) + 1;
  return { comp: comp.name, total: comp.clips.length, byKind };
}

bhippi.ready.then(() =>
  bhippi.expose('count_clips', {
    description: 'How many clips of each kind (media, text, shape …) a comp has. compId defaults to the active comp.',
    params: { type: 'object', properties: { compId: { type: 'string' } } },
  }, countClips).catch(showError));

bhippi.test('counts every clip once', async () => {
  const comp = await bhippi.comp();
  const result = await countClips({});
  const sum = Object.values(result.byKind).reduce((a, b) => a + b, 0);
  if (result.total !== comp.clips.length || sum !== result.total) throw new Error('the counts do not add up');
});
`;
clipCounter.files['spec.md'] = `# Clip counter

## What it does
Offers Bhippi AI the action count_clips: how many clips of each kind a comp has.

## UI
- None: it runs in the background.

## Bhippi tools it calls
- none: bhippi.comp() is a read.

## Permissions
- tools: none · network: none · chat: no

## Acceptance checks
- count_clips counts every clip exactly once.
`;

export const EXAMPLES: Example[] = [shotList, markerHere, clipCounter];
