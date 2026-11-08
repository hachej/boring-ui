// The surface fixture's page: a fictional plate image (plate.svg) the person comments on at a point. Served by the test.
export const surfacePage = () => `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>
body { margin: 0; font: 14px sans-serif; } #plate { position: absolute; left: 100px; top: 120px; width: 400px; height: 300px; display: block; }
</style></head><body><div id="app"><main data-feedback-visible=""><h1>Kiln plate</h1>
<img id="plate" tabindex="0" alt="Fictional kiln plate" src="/plate.svg"></main></div><script type="module" src="/entry.js"></script></body></html>`;
