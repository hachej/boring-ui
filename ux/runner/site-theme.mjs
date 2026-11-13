// The showcase's own look: the kit's tokens (registry.json item `theme`, read the way build.mjs reads it) and a small stylesheet over them. One accent: --primary.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './build.mjs';

const block = vars => Object.entries(vars).map(([key, value]) => `--${key}:${value};`).join('');

export function siteCss() {
  const { cssVars } = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.find(item => item.name === 'theme');
  return `:root{${block(cssVars.light)}color-scheme:light}
:root[data-theme=dark]{${block(cssVars.dark)}color-scheme:dark}
*{box-sizing:border-box;border-color:var(--border)}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
h1{font-size:1.75rem;line-height:1.2;margin:.1em 0 .3em;letter-spacing:-.015em}
h2{font-size:1.05rem;margin:2.2em 0 .6em}h3{font-size:.95rem;margin:1.2em 0 .4em}
p{margin:.5em 0}a{color:inherit;text-underline-offset:3px}
.muted{color:var(--muted-foreground)}.small{font-size:.85rem}
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;padding:18px 14px;border-right:1px solid var(--border);background:var(--card)}
.brand,.brand-sm{font-weight:700;text-decoration:none;letter-spacing:-.01em}.brand{display:block;font-size:1.05rem;margin:0 8px 18px}
.nav-title{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);margin:18px 8px 6px}
.side ul{list-style:none;margin:0;padding:0}
.side li a{display:block;padding:6px 8px;border-radius:calc(var(--radius) - 2px);text-decoration:none;font-size:.9rem}
.side li a:hover{background:var(--muted)}
.side li a[aria-current=page]{background:var(--primary);color:var(--primary-foreground)}
.content{min-width:0}
.bar{display:flex;align-items:center;gap:10px;padding:10px 24px;border-bottom:1px solid var(--border)}
.bar .brand-sm,.bar .menu{display:none}.grow{flex:1}
.icon-btn,.seg button,.chip,.copy,.try button{font:inherit;font-size:.88rem;color:var(--foreground);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:7px 12px;min-height:38px;cursor:pointer}
.icon-btn:hover,.chip:hover,.copy:hover,.try button:hover:not(:disabled){background:var(--muted)}
.try button:disabled{opacity:.5;cursor:default}
main{max-width:1180px;margin:0 auto;padding:28px 24px 72px}
.badge{display:inline-block;font-size:.72rem;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid var(--border);background:var(--muted)}
.lead{font-size:1.05rem;max-width:64ch;color:var(--muted-foreground);margin-top:0}
.toolbar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:18px 0 10px}
.seg{display:inline-flex}.seg button{border-radius:0;margin-left:-1px}.seg button:first-child{border-radius:var(--radius) 0 0 var(--radius);margin-left:0}.seg button:last-child{border-radius:0 var(--radius) var(--radius) 0}
.seg button[aria-pressed=true],.chip[aria-pressed=true]{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.chip{padding:4px 10px;min-height:32px;font-size:.82rem}
.stage{display:flex;justify-content:center;border:1px solid var(--border);border-radius:var(--radius);background:var(--muted);overflow:hidden}
.stage iframe{display:block;border:0;background:var(--background);max-width:100%}
.try{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
.try-label{margin:14px 0 6px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:.82rem;margin:.4em 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.usage{position:relative}.usage .copy{position:absolute;top:8px;right:8px;padding:3px 9px;min-height:30px;font-size:.78rem}
.status{border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:var(--radius);background:var(--card);padding:8px 14px;margin:14px 0}
.status ul{margin:.3em 0 0;padding-left:1.2em;font-size:.9rem}.status li{margin:.5em 0}
details{margin:.5em 0}summary{cursor:pointer;font-weight:600;padding:6px 0}
details.flow{border:1px solid var(--border);border-radius:var(--radius);background:var(--card);padding:2px 14px}
ol.steps{list-style:none;padding:0;margin:.6em 0;display:grid;gap:8px}
ol.steps>li{border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;background:var(--background)}
ol.steps .say{font-weight:600}ol.steps .expect{color:var(--muted-foreground);font-size:.9rem}
ul.facts2{margin:.4em 0 0;padding-left:1.2em;font-size:.86rem;color:var(--muted-foreground)}
.gap{color:var(--chart-3);font-weight:600}
video{display:block;max-width:100%;height:auto;margin:6px 0;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px)}
footer{margin-top:56px;font-size:.8rem;color:var(--muted-foreground)}
@media (max-width:860px){
  .shell{display:block}
  .side{position:fixed;z-index:20;inset:0 auto 0 0;width:min(82vw,300px);height:100vh;transform:translateX(-102%);transition:transform .18s ease;box-shadow:0 0 0 100vmax transparent}
  body.nav-open .side{transform:none;box-shadow:0 0 0 100vmax rgba(0,0,0,.45)}
  .bar{padding:8px 16px;position:sticky;top:0;background:var(--background);z-index:10}.bar .brand-sm,.bar .menu{display:inline-block}
  main{padding:12px 16px 56px}h1{font-size:1.25rem}.badge{display:none}.lead{font-size:.92rem}.toolbar{margin:10px 0 8px;gap:8px}.try-label{margin:8px 0 4px}
  .chips{flex-wrap:nowrap;overflow-x:auto;margin-inline:-16px;padding:0 16px}.chips>*{flex:none}
  .toolbar{flex-direction:column;align-items:stretch}.seg button{flex:1}
  .try{flex-wrap:nowrap;overflow-x:auto;margin-inline:-16px;padding:0 16px 4px}.try button{white-space:nowrap;flex:none}
}
@media (prefers-reduced-motion:reduce){.side{transition:none}}`;
}
