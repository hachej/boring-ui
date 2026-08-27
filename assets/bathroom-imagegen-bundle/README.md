# Bathroom image-generation bundle

## Upload order

1. `01-floor-plan-bathroom.png` — strongest structural reference.
2. `02-reference-mirrors.png` — mirror shape only.
3. `03-reference-dark-wood-wall.png` — wall materials and mood.
4. `04-composition-guide.png` — optional low-weight composition guide.

Paste `prompt.txt` into the main prompt and `negative-prompt.txt` into the negative-prompt field. If the generator accepts per-image influence, use the weights in `settings.json`.

The floor plan always has priority over the style images. The second reference contains a walk-in shower, but this project must retain the bathtub/shower combination shown on the plan.

`00-reference-map.jpg` is a quick visual explanation of what to take from each image. `PROMPT.md` contains the full creative brief and requested variant list.
