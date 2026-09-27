# Step overhead by kind of video

Before any work, one step used to carry the whole prompt and every tool: **~69,105 tokens**. Measured 2026-09-26 (tokens ≈ bytes ÷ 4).

Edit-phase steps (most of a production). Plan-phase steps shown for comparison.

| Brief | Genres | Tools whole | Prompt | Catalogue | Per edit step | Saving | Per plan step |
|---|---|---|---|---|---|---|---|
| saas-ad | saas | 60 | 11,893 | 24,140 | 36,033 | 48% | 33,649 |
| saas-characters-drawn | saas, motion, character2d | 77 | 13,160 | 29,149 | 42,309 | 39% | 39,926 |
| motion-graphics | motion | 60 | 11,228 | 23,962 | 35,190 | 49% | 32,807 |
| character-story | motion, character2d | 68 | 11,426 | 26,325 | 37,751 | 45% | 35,368 |
| 3d-promo | saas, 3d | 68 | 11,893 | 26,440 | 38,333 | 45% | 35,950 |
| documentary | documentary | 61 | 9,609 | 23,314 | 32,923 | 52% | 30,540 |
| meme | meme | 58 | 9,401 | 25,508 | 34,909 | 49% | 32,526 |
| podcast-edit | edit | 65 | 9,999 | 23,398 | 33,397 | 52% | 31,013 |
| shorts | shorts | 51 | 9,999 | 20,993 | 30,992 | 55% | 28,608 |
