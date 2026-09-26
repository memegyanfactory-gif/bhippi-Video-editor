# Sculpted 3D characters

Two rigged base characters, one male and one female, built in Blender and driven in the browser by the ToonKit move library.

![Base meshes](renders/base-meshes.png)
![Wardrobe](renders/wardrobe-hero.png)

## What is here

| Path | What it is |
| --- | --- |
| `blender/` | Headless Blender pipeline that builds, rigs, dresses and exports both characters. |
| `studio/male.glb`, `studio/female.glb` | Exported characters: skinned, 51 bones, Draco-compressed, about 0.8 MB each with the whole wardrobe. |
| `studio/rig3d.js` | Runtime that loads the `.glb` files, applies a CharacterSpec and turns a ToonKit pose into bone rotations. |
| `studio/toonkit.js` | Move, camera, prop and FX library, plus the Director and the AI tool schemas. It picks Rig3D when the sculpted characters are loaded. |
| `studio/toon3d.js` | The earlier procedural toon builder, kept as a fallback (`spec.engine: "toon"`). |
| `studio/studio.src.html`, `studio/build.py` | Character Studio 3D page source and its single-file build. |
| `renders/` | Cycles renders and Studio screenshots. |

## How the characters are made

1. **Base mesh.** The start is Blender's free CC0 *Human Base Meshes* bundle (stylized male and female bodies, clean quad topology, same vertex count). It is not committed; download `human-base-meshes-bundle-v1.4.1.zip` from blender.org/download/demo-files.
2. **Stylize** (`stylize.py`, `brush.py`). Scripted sculpt brushes (grab, scale, inflate, smooth and an eyelid-droop brush) push the bases toward the reference style: long hanging nose, heavy sleepy lids, longer neck, heavier brow ridge.
3. **Hair and brows** (`hair.py`). Tapered bezier clumps are laid over the scalp by a flow field, on top of a scalp cap. The male has a messy short cut; the female has long side-parted hair.
4. **Eyes** (`eyes.py`). Planar UVs and a painted iris texture, so the iris survives skinning and glTF export.
5. **Rig** (`rig.py`). Joints are found from the mesh itself: horizontal slices of a dense surface sample separate the arms from the torso, and 1-D k-means on the hand finds the fingers. Blender's automatic weights then bind the skin.
6. **Wardrobe** (`wardrobe.py`, `garment.py`). Garments are cut from the bound body by bone weights and plane cuts, lifted along normals, draped with smoothing and an outside-only shrinkwrap, and given a minimum distance from each bone for a loose fit. Items: T-shirt, long sleeve, hoodie, open jacket, straight jeans, shorts, skirt and sneakers (a convex hull around the foot with a white sole), plus underwear. Weights are transferred from the body.
7. **Export**. Armature modifiers go first in each stack, the body is exported without subdivision (normals stay smooth), and meshes are Draco-compressed.

Rebuild everything (Blender 4.2 LTS):

```sh
blender -b human_base_meshes_bundle.blend -P blender/make_cast.py -- out/cast export 8
```

Other modes: `head`, `body`, `hero` (Cycles presentation shots) and `pose` (rig test). Garments to show in `hero` renders are chosen with `wear_m=tshirt+jeans+sneakers` and `wear_f=...`.

## Using them from the app or an AI

A character is the same CharacterSpec used by the 2D Character room. Rig3D maps it onto the sculpted bases:

- `body` chooses the base: `fem` gives the female base, anything else the male.
- `age` and `shape` scale the rig.
- `skin`, `hair.color` and `face.eyeColor` recolour the materials.
- `top.kind`, `outer`, `bottom.kind` and `shoes` choose which wardrobe pieces show, and set their colours.

Shots are unchanged JSON (`actors`, `beats`, `camera`, `props`, `fx`) built only from library names. That is what the AI tools `list_toon_library`, `create_character3d`, `direct_shot`, `preview_shot` and `export_shot` produce. Poses are solved with two-bone IK and proper bend planes for arms and legs, curl axes for all fingers, and gaze and blink on the eyes.

For the published page the `.glb` files are converted to embedded glTF JSON (`glb2json.py`), because the artifact host does not serve `.glb`. Draco decoding uses three.js's pure-JS decoder, shipped next to the page.

## Work on it locally

You need Node 18 or later, Python 3, and Blender 4.2 LTS if you want to rebuild the characters.

```sh
cd docs/character-studio/3d/studio
npm install                      # three@0.160.0 and playwright
npx playwright install chromium  # first time only
npm run build                    # studio.html + studio_local.html, and the *.gltf.json copies of the .glb files
npm run serve                    # http://localhost:8765/studio_local.html
```

Open `studio_local.html` for the Studio, which uses local three.js. `rigtest.html?m=wave,point&t=.9` shows moves side by side, and `&z=3.4&ly=1.35` zooms in.

### Test tools (run while `npm run serve` is up)

| Command | What it does |
| --- | --- |
| `node st.mjs` | Screenshots the Studio: Character, Moves and Shots modes. |
| `node wavetest.mjs wave .3 .55 .8` | Renders a move at several times. |
| `node csp.mjs csp_local.html` | Loads the page under the artifact viewer's strict CSP. `npm run build` also writes `csp_local.html`. |
| `node montage.mjs out.png 400 a.png b.png` | Puts images side by side. |

### Rebuilding the characters in Blender

1. Download Blender's free *Human Base Meshes* bundle (v1.4.1) from blender.org/download/demo-files.
2. Run:

   ```sh
   blender -b human_base_meshes_bundle.blend -P ../blender/make_cast.py -- out/cast export 8 build=average
   ```

   Repeat with `build=slim` and `build=heavy`. The results are `out/cast_m.glb`, `out/cast_f.glb`, `out/cast_m_slim.glb` and so on. Copy them into `studio/` as `male.glb`, `female.glb`, `male_slim.glb`, …
3. Quality checks:
   - `rom` mode renders the range-of-motion sheet: head turns and pitch, arms up and forward, and a squat.
   - `-P ../blender/wcheck.py` finds vertices with no weights or weights on the wrong side.
   - The `3d-specialist` agent (`.claude/agents/3d-specialist.md`) grades the renders.

### UI mockup

`docs/character-studio/ui/characters-ui.html` is the Characters plugin mockup. Its thumbnails are rendered by `ui/thumbs.html` with `thumbs.mjs`: serve the `studio/` folder, then copy `thumbs.html` and `thumbs.mjs` into it.

### Next steps

See `docs/CHARACTERS-PLUGIN-PLAN.md`, sections 6 and 7. The next step is the motion library. Put `Universal Animation Library[Standard].zip` (Quaternius, CC0) under `assets/third-party/quaternius/`, then retarget its clips to this rig and play them with three.js `AnimationMixer`.
