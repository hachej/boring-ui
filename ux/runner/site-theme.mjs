// The showcase's own look: the kit's tokens (registry.json item `theme`, read the way build.mjs reads it) and a small stylesheet over them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './build.mjs';

const block = vars => Object.entries(vars).map(([key, value]) => `--${key}:${value};`).join('');

export function siteCss() {
  const { cssVars } = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.find(item => item.name === 'theme');
  return `:root{${block(cssVars.light)}color-scheme:light}
@media (prefers-color-scheme:dark){:root{${block(cssVars.dark)}color-scheme:dark}}
*{box-sizing:border-box;border-color:var(--border)}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:960px;margin:0 auto;padding:20px 16px 64px}
h1{font-size:1.6rem;line-height:1.2;margin:.2em 0 .4em;letter-spacing:-.01em}
h2{font-size:1.15rem;margin:2em 0 .6em}h3{font-size:1rem;margin:1.4em 0 .4em}
p{margin:.5em 0}a{color:inherit;text-underline-offset:3px}
.muted{color:var(--muted-foreground)}.small{font-size:.85rem}
nav.top{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--card)}
nav.top a{text-decoration:none;font-weight:600}
.lead{font-size:1.05rem;max-width:62ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:12px}
.card{display:block;text-decoration:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px}
.card:hover,.card:focus-visible{border-color:var(--ring)}
.card h3{margin:0 0 .3em}.card p{margin:0;color:var(--muted-foreground);font-size:.9rem}
.badge{display:inline-block;font-size:.75rem;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid var(--border);background:var(--muted);margin-bottom:8px}
.status{border:1px solid var(--border);border-left:4px solid var(--ring);border-radius:var(--radius);background:var(--card);padding:10px 14px;margin:14px 0}
.status details{margin:.4em 0 0}.status ul{margin:.3em 0 0;padding-left:1.2em;font-size:.9rem}.status li{margin:.5em 0}
.facts{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:.85rem;color:var(--muted-foreground)}
.toggles{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.seg button{font:inherit;font-size:.9rem;padding:8px 14px;min-height:40px;border:0;background:var(--card);color:var(--foreground);cursor:pointer}
.seg button[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground)}
.stage{border:1px solid var(--border);border-radius:var(--radius);background:var(--muted);overflow:hidden;display:flex;justify-content:center}
.stage .box{position:relative;overflow:hidden}
.stage iframe{border:0;transform-origin:0 0;background:#fff;position:absolute;left:0;top:0}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.shots.wide{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.shots figure{margin:0}.shots figcaption{font-size:.8rem;color:var(--muted-foreground);padding-top:3px}
img,video{max-width:100%;height:auto;display:block;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px)}
.strip{overflow-x:auto}.strip img{max-width:none;max-height:none;width:auto}
details{margin:.6em 0}summary{cursor:pointer;font-weight:600;padding:6px 0}
ol.steps{list-style:none;padding:0;margin:.6em 0;display:grid;gap:8px}
ol.steps>li{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px}
ol.steps .frame{display:none}ol.steps .say{font-weight:600}ol.steps .expect{color:var(--muted-foreground);font-size:.9rem}
ul.facts2{margin:.4em 0 0;padding-left:1.2em;font-size:.88rem}
.gap{color:var(--chart-3);font-weight:600}
pre{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;overflow-x:auto;font-size:.82rem;margin:.4em 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (max-width:760px){.strip{display:none}ol.steps .frame{display:block;margin-bottom:8px}main{padding-top:14px}nav.top{flex-wrap:wrap}.seg button{flex:1}.toggles{flex-direction:column}.shots{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.shots.wide{grid-template-columns:1fr}}
footer{margin-top:48px;font-size:.8rem;color:var(--muted-foreground)}`;
}
