# Character room plan: the "Character" plugin

**The goal.** The user opens **Character** from the plugins panel. A full-screen room opens, with a
**Home** button at the top.

In the room they:
- design a character: age, body, build, skin, face, hair, clothes and accessories;
- watch it move;
- name it and save it.

In any project, `/character Mira` (or `/character(Mira)`) brings that character into the chat, and the AI
animates it in the video.

**Prototype.** `docs/character-studio/character-room.html` is a working prototype. It is a single file:
open it in a browser. It is the reference for the look, the controls and the data model below. The
character sheets in the same folder show earlier steps (`theo2-sheet.png`, `cast-sheet.png`).

This plan builds on `docs/CHARACTER-STUDIO-PLAN.md`: the rig, motion v2, the licence rules and the AI tools.

---

## 1. What makes these characters feel alive

Learned from the reference kits (constructor sheets, teen cast, cartoon girl):

- **Exaggeration you can dial.**
  - Big heads: 1:3.6 for kids, about 1:5.5 for adults.
  - Big hands.
  - Rosy cheeks.
  - Toon eyes with white sclera.
- **Stance, not a T-pose.** Hand on hip, a peace sign, hands in pockets, holding a cup or phone. A saved
  character keeps its stance as its "resting personality".
- **Surface detail.** Patterns (hearts, plaid, camo, dots, stripes), cuffs, pockets, laces, drawstrings.
- **Accessories that say who they are.** Headband, bow, cap, beanie, headphones, glasses, sunglasses,
  hoops, studs, nose ring, bangles, watch, chain, pendant, scarf, tie, backpack, crossbody bag, and a cup,
  phone or book in hand.
- **Colour linework, not black.** The "Colour line" style draws each outline as a darker shade of its
  fill. "Flat" (no line) and "Ink line" are the other two styles.
- **Always a little alive.** Breathing, blinks, a small head sway, and a ponytail and drawstrings that
  sway (secondary motion).
- **No lines at joints.** Every body group (skin, shirt, arm + hand, legs) is drawn as one merged
  silhouette. Sleeve and shoulder caps are re-filled over the joint, so shoulders, elbows and wrists
  never show a seam.

---

## 2. How it fits into Bhippi (grounded in the current code)

### 2.1 A built-in plugin that opens full screen

- **Today every plugin is user- or AI-made.** It is an HTML page inside a sandboxed iframe:
  - `src/plugins/types.ts:21`;
  - `PluginFrame.tsx:82`;
  - the library is kept in `plugins.json`.
- **Character should be a first-party, native React workspace,** not an iframe plugin, because it needs:
  - the character engine;
  - the motion renderer, for the exact same drawing in export;
  - app storage;
  - the chat.
- **Add a small "built-in plugins" list to the plugins panel** (`src/plugins/PluginsPanel.tsx`).
  - Each entry is `{id, name, icon, open()}`.
  - It is shown above user plugins, with a "Built-in" badge.
  - Built-ins are never saved into `plugins.json` and can't be deleted.
- **Opening** sets `characterRoomOpen` in `App.tsx`, the same way the Plugin Maker does:
  - state at `App.tsx:178`, rendered at `App.tsx:3013`;
  - `.plugin-maker{position:fixed;inset:0;z-index:900}` in `src/styles/plugins.css:19`.
- **Header:** `← Home` (Esc), then the Character logo, then a name field, **Save**, and the `/character`
  chip. It follows the Plugin Maker header (`PluginMaker.tsx` ~115).
- **Icon:** the prototype's logo. It is a friendly bust with a sparkle on an orange→violet rounded
  square. Ship it as `src/assets/character-plugin.svg`, and use a lucide `UserRound` fallback in dense
  menus.
- **Theme:** the room uses the app tokens (`--app`, `--panel*`, `--blue`, `--line*` from
  `src/styles/app.css:3`). The stage is a soft lilac "room", so the characters pop.

### 2.2 Layout (from the prototype)

| Area | What it holds |
|---|---|
| Left rail, "My characters" | Saved characters as round portraits with name and age. Click to load. Menu: rename, duplicate, delete (an in-page confirm), export `.json` |
| Top of the stage, identity bar | Age (kid / teen / adult / senior), body (masculine / feminine / neutral), build (slim / average / round), height, skin (8 tones plus a custom colour), style (colour line / flat / ink), **Surprise me** |
| Stage | The live, animated character on a floor, with name and summary |
| Under the stage, action bar | *Try:* Wave, Hop, Talk, Happy (later: Walk, Point, Shrug, Celebrate). *Pose:* relaxed, hand on hip, peace, pockets, holding |
| Right side, wardrobe | Tabs: **Face** (shape, eyes, eye colour, brows, nose, mouth, facial hair), **Hair** (14 styles, 10 colours), **Tops** (8, plus jacket layer, colour, pattern), **Bottoms** (6, colour, pattern), **Shoes** (6, colour), **Extras** (head, face, neck, wrists, bags, in hand) |

- **Every tile is a live preview of the user's own character** wearing that item. A cap tile shows *your*
  character in the cap; tiles are cropped to the head, torso, legs or feet.
- **The base character** wears only shorts. Feminine and neutral bodies also wear a simple crop top.
- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z) covers every change in the room.

### 2.3 The data: `CharacterSpec`

The prototype's spec, versioned:

```ts
type CharacterSpec = {
  version: 1; id: string; name: string; createdAt: number; updatedAt: number;
  style: 'pop' | 'flat' | 'ink';
  age: 'kid' | 'teen' | 'adult' | 'senior'; body: 'masc' | 'fem' | 'neutral'; build: 'slim' | 'average' | 'round'; height: number;
  skin: string;
  face: { shape; eyes; eyeColor; brows; nose; mouth; facialHair };
  hair: { style; color };
  top: { kind; color; pattern }; outer: { kind; color }; bottom: { kind; color; pattern }; shoes: { kind; color };
  acc: string[];           // item ids: 'cap', 'bangles', 'cup', …
  stance: 'relaxed' | 'hip' | 'peace' | 'pocket' | 'hold';
  personality?: 'cheerful' | 'shy' | 'bold' | 'calm' | 'nerdy' | 'sporty';   // §4
};
```

### 2.4 Where saved characters live

- **Global library:** `<appRoot>/characters.json`, so characters are shared across all projects.
  - New Rust commands `characters_load` / `characters_save` follow the `learning_load/save` pattern
    (`src-tauri/src/lib.rs:2297`, `src/lib/ipc.ts:602`).
  - A store `src/characters/store.ts` is read with `useSyncExternalStore`, like `src/plugins/store.ts`.
- **In a project:** when a character is placed, the **whole spec is copied into the motion layer**, so the
  project renders on any machine. `extras.brandKit` in the `.bhippi` file sets this precedent
  (`types.ts:780`).
  - Later edits in the room don't silently change old videos.
  - The layer shows "Update to latest Mira" when the library version is newer.

### 2.5 The engine in the app

- **New `src/motion/character/v2/`:**
  - `spec.ts`: types and defaults;
  - `rig.ts`: `rigFor(spec)`, proportions by age, body and build;
  - `catalog.ts`: every wardrobe item as data;
  - `draw.ts`;
  - `pose.ts`: stance and the action solver.
- **One drawing path, two outputs.** The same path strings drive SVG (UI tiles, the rail, the stage) and
  Canvas2D (`ctx.fill(new Path2D(d))`) for the motion renderer. Patterns become `CanvasPattern`s. The
  preview and the export are therefore identical: the renderer already uploads the character canvas as a
  texture (`src/motion/gl/renderer.ts:222`).
- **The motion layer** gains `CharacterData.kind: 'custom'` with `spec: CharacterSpec`. This touches:
  - `types.ts:41`;
  - `validate.ts:73`, which accepts `custom` with a valid spec;
  - `evaluate.ts:150`, where the box size comes from `rigFor`;
  - `ai-tools.json:5763`, where the enum becomes free text: a saved name or a built-in kind.
- **The existing 20 actions** (`wave`, `point`, `walk`, `talk`, `hop`, `shrug`…) re-map onto the v2 rig. A
  character keeps its **stance** between actions, so Mira returns to her peace-sign rest.

### 2.6 `/character` in chat

- **The command itself:** add `/character` to `src/chat/commands.ts`.
  - Use `/ref` (:144) as the template.
  - `options(ctx)` returns the saved names, so typing `/character M` suggests "Mira".
- **Both spellings work:** `/character Mira` and `/character(Mira)`.
  - Extend the split in `runIfCommand` (`ChatPanel.tsx:1022`) and in `matchCommands` (:215) to also
    split on `(` and strip `)`.
  - Names with spaces use quotes: `/character "Grandma Rosa"`.
- **What it does:**
  - It attaches the character to the next turn, as an `@` reference does (ChatPanel :953), and says
    *"Mira is ready. Tell me what she should do."*
  - The next message ("Mira waves and introduces the product") makes the AI call
    `create_character {character:"Mira", actions:[…]}`.
  - With no name, `/character` opens the room.
- **The AI always knows the library.** `getContext` (`App.tsx:2844`) adds `characters: charactersBrief()`
  on every turn: names, age, look and personality, one line each.

### 2.7 AI tools

| Tool | New or changed | What it does |
|---|---|---|
| `list_characters` | new, read-only | Saved characters, with a one-line description and a portrait path |
| `get_character` | new, read-only | Full spec by name |
| `design_character` | new | Creates or edits a saved character from words: "make a grumpy old fisherman with a beanie and a beard". The AI fills the spec from the catalogue, so it can only pick real items. The user sees it appear in the room's rail |
| `create_character` | changed | `character` accepts a saved name, or a spec inline |
| `animate_character`, `lip_sync_character` | unchanged | They work on custom characters too |

---

## 3. The wardrobe as data (so it can keep growing)

Every item is one catalogue entry:

```ts
{ id: 'hoodie', slot: 'top', layer: 'torso', label: 'Hoodie',
  fits: { age: ['kid','teen','adult','senior'], body: ['masc','fem','neutral'] },
  colour: { slots: ['main'], default: '#3F7FC1' }, patterns: true,
  sleeve: 0.95, hem: 'hip+26',
  draw: 'builtin:hoodie' | { svg: 'items/hoodie.svg', anchors: {...} } }
```

- **Built-in items** are parametric: drawn from the rig, like the prototype, so they fit every age, body
  and build automatically.
- **Art items** are SVG files drawn against **anchor points**: neck, shoulders, chest, waist, hips,
  wrists, ankles and head box. They are stretched to each rig. This is how the user's clean character
  sheet, or a CC0 pack, gets imported (the Cutter, `CHARACTER-STUDIO-PLAN.md` §3.5).
- **Slots and conflicts:**
  - one head item;
  - one in-hand item, which switches the stance to *holding*;
  - a dress replaces the bottoms;
  - a jacket sleeve wins over a shirt sleeve.
- **Content targets for version 1:**

  | Slot | Count |
  |---|---|
  | Faces | 4 shapes × 5 eyes × 5 brows × 5 noses × 6 mouths × 5 facial hair |
  | Hair | 14 styles |
  | Tops | 8 |
  | Jackets | 3 |
  | Bottoms | 6 |
  | Shoes | 6 |
  | Patterns | 6 |
  | Accessories | 28 |

  The prototype already has all of these. Next come more views (§5), then more items with each release.

---

## 4. Personality (the "characterness" dial)

`personality` sets defaults the user can still override:

| Personality | Idle | Walk | Face | Stance |
|---|---|---|---|---|
| cheerful | bouncy breathing, frequent small smiles | a spring in the step | happy | peace or relaxed |
| shy | looks down, fidgets, slow blinks | small steps | sleepy or soft | pockets |
| bold | chest out, a slow nod | a wide stride | smirk | hand on hip |
| calm | slow breathing | even | smile | relaxed |
| nerdy | pushes up the glasses | quick | grin | holding a book |
| sporty | shifts weight, stretches | a jog-walk | grin | relaxed |

The AI reads the personality when it animates: "Pip reacts" plays a shy reaction for a shy Pip.

---

## 5. Phases

| Phase | Weeks | Deliverables | Done when |
|---|---|---|---|
| **A. Engine v2 in the app** | 2 | `src/motion/character/v2` (spec, rig, catalogue, SVG and Canvas2D drawing), the `custom` layer kind, validation, tests (a spec round-trip, no-seam checks, a render snapshot per age × body) | A saved spec renders the same in the room and in export |
| **B. The room** | 2 | Built-in plugin entry and icon; full-screen room; identity bar; wardrobe tabs with live tiles; stage animation; save, rename, duplicate, delete; undo/redo | A user can build and save Mira in under a minute |
| **C. Chat + AI** | 1 | `/character` (both spellings, autocomplete); the context brief; `list_characters`, `get_character`, `design_character`; `create_character` by name | "/character Mira, have her wave and say hi" produces a correct scene |
| **D. Motion on the new rig** | 2 | The 20 actions re-mapped; stance-aware rests; personality idles; walk, run and sit with foot planting (`CHARACTER-STUDIO-PLAN.md` motion v2) | The contact sheets pass QA |
| **E. Views and content** | 3 | 3/4 and side views (needed for walking across a scene); +20 wardrobe items; the Cutter for the user's clean sheet and CC0 packs | Walk-across scenes look right; the user's sheet imports |

## 6. Decisions to confirm
1. **Native built-in plugin (recommended) vs an iframe plugin.** Native gets the real renderer and storage.
   An iframe plugin would need a new SDK bridge for both.
2. **The global library in `characters.json`, plus a copy inside each project** (recommended), vs
   project-only characters.
3. **The default style for new characters:** colour line (recommended, like the teen-cast sample), flat,
   or ink.
