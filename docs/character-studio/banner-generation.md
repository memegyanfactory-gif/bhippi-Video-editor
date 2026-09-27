# Characters banner generation

## Current revision: original-character crowd

Current image: `public/characters/characters-banner-crowd.png` (3000 × 1000 PNG).

Editable source/export page: `docs/character-studio/banner-crowd.html`. This revision repeats only the same 20 original preset designs into a 64-member crowd: 24 back, 16 middle, 10 near, and 14 foreground figures. It retains the exact original renderer settings, faces, expressions, outfits, colors, and linework; only uniform scale, placement, overlap, and layer ordering change. No random specs, new characters, recoloring, flipping, or AI redrawing are used. The icon badge is omitted so only the requested original cast appears.

The stronger headline is “500+ CHARACTERS,” with warm yellow/plum dimensional type on a tilted cream sign. Foreground tall hats are kept outside the text region. Deliberate edge cropping and staggered overlapping figures create crowd depth; every original identity has a recognizable appearance. Final PNG was visually inspected, including headline legibility and all 20 identities. The requested 500+ wording is promotional copy, not a verified count of unique presets.

## Previous revision: original app artwork

Previous image, preserved: `public/characters/characters-banner-original-cast.png` (3000 × 1000 PNG).

The user rejected the generated version below because it changed the characters' look. The current revision composes all 20 original app characters directly with the app's own 2D renderer, without AI redrawing, recoloring, or restyling. The approved icon is embedded unchanged above the headline. Uniform scaling per group preserves original proportions and relative character sizes.

Editable composition and PNG export: `docs/character-studio/banner-original-cast.html`. Character render settings match the reference sheet: `t: 0`, `yaw: 0.18`, `headYaw: 0`, `headPitch: 0`, original stance, no hand override, and no renderer shadow. Each character has a unique SVG ID prefix.

The requested headline remains “MORE THAN 500 CHARACTERS.” This is promotional copy requested by the user, not a verified count of distinct library presets. The inspected library contains 20 characters. No app character assets or UI were changed by this revision.

## Previous generated version (superseded)

Generated with the built-in image-generation tool. No CLI/API fallback used.

Previous image, preserved: `public/characters/characters-banner-500.png` (2172 × 724, opaque PNG).

Reference: all 20 characters shown in the app's library, captured using its actual renderer in `banner-cast-reference.png`, plus the user-approved icon. Banner wording was requested by the user; generation does not add 500 character assets to the app. This task creates a banner file only and does not insert it into the app UI.

## Initial prompt

Use case: ads-marketing.
Asset type: a polished, fun, wide horizontal promotional banner for the Characters plugin. Transform the square icon's visual world into a new ensemble banner, approximately 3:1 landscape, high resolution.
Input images: Image 1 is the approved icon, a STYLE and BRAND-MASCOT reference. Preserve the blonde pigtails, round glasses, warm brown skin, emerald jacket, blue gingham shirt and cheerful peace-sign identity. Image 2 is the complete ACTUAL APP CAST identity sheet. It is an identity reference, NOT the final layout.
Primary request: show ALL 20 distinct app characters from Image 2, plus the icon mascot, celebrating together around a spectacular, extremely legible central headline. Do not substitute a generic crowd. Each cast member appears once, with recognizable skin, face, hairstyle, outfit and signature accessory. Use the sheet's actual depictions when descriptions are ambiguous.
Cast checklist: Mira (ginger ponytail, yellow heart tee); Bones (white skeleton, black top hat); Franky (coral-red stocky monster, purple hair and tank, bolts); Vex (blue skin, pointed ears, blue hair, white backward cap, black leather); Luna (green witch, orange hair, purple witch hat and dress); Rex (mustached cowboy, brown hat/vest, red plaid); Kai (brown teen, green hoodie/cap/headphones, orange trousers); Nora (black bob, sunglasses, black leather, red stripes); Sam (child, red beanie/puffer, yellow shoes); Priya (dark skin, black bun, navy pantsuit); Leo (dark skin, afro, red and cream varsity jacket); Coco (blonde pigtails, yellow bucket hat, pink dotted shirt, blue overalls); Sir Reginald (elderly, black top hat, glasses, tan trench, tie); Queen Bea (older brown-skinned woman, pale curls, crown, coral cardigan, purple polka-dot dress); Wolfie (brown wolf-like face/pointy ears, shaggy hair, blue jacket, green shirt, yellow shorts); Angel (blonde curly child, halo, ivory top, blue shorts); Rain (yellow raincoat/bucket hat/boots); Mo (bearded round man, red beanie, green bomber); Zed (green lanky teen, blue stitched hair, coral shirt, violet trousers); Grandpa Joe (older round mustached man, glasses, brown fedora/sweater, gray trousers).
Style: premium 2D cartoon illustration matching the approved icon, confident dark-plum outlines, clean rounded silhouettes, expressive friendly faces, subtle cel shading and rich coordinated color. NOT 3D. Bring the app cast up to the icon's polished illustration finish without redesigning their identities.
Composition: a joyful ensemble-poster arrangement, layered playful characters framing a spacious center. Organize the cast into two staggered, overlapping bands around the top, sides and lower edge, mixing close-up faces and waist-up figures, with a few fuller lively poses. All 20 distinct faces must remain clearly visible and countable. The icon mascot is prominent in the foreground but must not hide a cast member. Some wave, give peace signs, lean around the headline or laugh together. Avoid a rigid roster grid, labels or evenly spaced passport portraits.
Background: light lavender with a few sweeping emerald/coral curves and small yellow sparkles/confetti. Use the icon's lavender, emerald, golden-yellow and plum palette, balanced with the actual cast's outfit colors. Fun, energetic and welcoming; not cluttered.
Text (verbatim): "MORE THAN 500 CHARACTERS".
Typography: only these words, exactly once. Center "MORE THAN" above a huge dimensional-looking but flat-illustrated golden-yellow "500", with "CHARACTERS" in strong rounded dark-plum lettering below. Crisp, expertly kerned, high-contrast display type; headline dominates and is immediately readable at banner size. Characters can gesture toward it but never cover any letter.
Constraints: include every named app character; preserve the approved mascot. No extra invented people, no duplicate faces, no character name labels, no logo from another company, no buttons, no watermarks, no square icon border, no black exterior padding. Full-bleed rectangular finished banner.

## Final correction prompt

Use case: precise-object-edit.
Image 1 is the existing finished banner EDIT TARGET. Image 2 is the named actual app cast REFERENCE.
Make only these targeted cast corrections; preserve the entire canvas size, headline, typography, colors, fun composition, central icon mascot, and every other unique character:
1. REMOVE the DUPLICATE Kai midway down the LEFT side, the green-hoodie boy with green cap/headphones located between Leo's red varsity jacket and the large blonde mascot. Keep the ORIGINAL Kai at the TOP, right of the cowboy and left of Nora. Replace only the removed duplicate's area with the lavender/emerald background, not a new person.
2. REPLACE the DUPLICATE Sam at the LOWER LEFT (red beanie and red puffer, beneath Leo and left of the mascot) with COCO from Image 2: a pale freckled little girl with blonde pigtails, a YELLOW BUCKET HAT with small colored hair clips, PINK POLKA-DOT TEE and BLUE OVERALLS. Keep this lively raised-arm pose. Keep the original Sam at the TOP RIGHT in the red puffer and red beanie between Nora and Priya.
3. CORRECT RAIN just to the lower-right of the word CHARACTERS: keep the YELLOW RAINCOAT, YELLOW BUCKET HAT and happy pose, but make this the actual Rain from the reference: TAN SKIN, SHORT BROWN SIDE-PARTED HAIR, RED STRIPED SCARF and wide eyes. NO blonde pigtails and NO colored hair clips on Rain. Those traits belong exclusively to Coco at lower left. Rain is a distinct character, not Coco dressed in yellow.
4. Remove the small unidentifiable orange/yellow torso fragment peeking behind the large mascot's left elbow if it has no corresponding visible character face.
COUNT CHECK: exactly the 20 distinct app cast characters PLUS the approved central blonde green-jacket mascot = 21 visible faces, each once. All unique existing characters remain: Mira, Bones, Franky, Vex, Luna, Rex, Kai, Nora, Sam, Priya, Leo, Coco, Sir Reginald, Queen Bea, Wolfie, Angel, Rain, Mo, Zed, Grandpa Joe. No omitted faces, no extra anonymous faces.
Keep the exact existing headline "MORE THAN 500 CHARACTERS", untouched. Keep all other visual elements and poses as close to Image 1 as possible. No names, new text, or watermarks. Clean professional 2D cartoon edges, same full-bleed 3:1 banner.
