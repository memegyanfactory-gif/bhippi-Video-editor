# Step overhead by kind of video

Before any work, one step used to carry the whole prompt and every tool: **~73,747 tokens**. Measured 2026-09-29 (tokens ≈ bytes ÷ 4).

Edit-phase steps (most of a production). Plan-phase steps shown for comparison.

| Brief | Genres | Tools whole | Prompt | Catalogue | Per edit step | Saving | Per plan step |
|---|---|---|---|---|---|---|---|
| saas-ad | saas | 62 | 12,164 | 25,671 | 37,835 | 49% | 35,480 |
| saas-characters-drawn | saas, motion, character2d | 79 | 13,431 | 30,737 | 44,168 | 40% | 41,813 |
| motion-graphics | motion | 62 | 11,499 | 25,497 | 36,996 | 50% | 34,641 |
| character-story | motion, character2d | 70 | 11,697 | 27,912 | 39,609 | 46% | 37,255 |
| 3d-promo | saas, 3d | 70 | 12,164 | 27,971 | 40,135 | 46% | 37,781 |
| documentary | documentary | 61 | 9,880 | 24,382 | 34,262 | 54% | 31,908 |
| meme | meme | 58 | 9,672 | 26,576 | 36,248 | 51% | 33,893 |
| podcast-edit | edit | 65 | 10,270 | 24,465 | 34,735 | 53% | 32,381 |
| shorts | shorts | 51 | 10,270 | 22,060 | 32,330 | 56% | 29,976 |
