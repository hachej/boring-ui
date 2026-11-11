// Builders for the target: the kit's composer parts, drawn with the kit's tokens. Fictional content only.
const P = {
  up:'<path d="m18 15-6-6-6 6"/>', down:'<path d="m6 9 6 6 6-6"/>',
  clip:'<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  send:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="1"/>',
  x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check:'<path d="M20 6 9 17l-5-5"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  right:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>', bottom:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', alert:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  left:'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  expand:'<path d="m7 15 5-5 5 5"/><path d="m7 9 5-5 5 5"/>', pencil:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
};
const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const ib = (n, cls='', label='', dot=false) => `<span class="ib ${cls}" role="img" aria-label="${label}" title="${label}">${ic(n)}${dot?'<span class="dot"></span>':''}</span>`;
const chip = (name, kind='') => kind==='up' ? `<span class="chip up"><span class="spin"></span>${name} · envoi…</span>`
  : kind==='img' ? `<span class="chip"><span class="th"></span>${name}${ic('x')}</span>` : `<span class="chip">${ic('file')}${name}${ic('x')}</span>`;
const target = who => `<span class="chip tg">À : <b style="font-weight:600">${who}</b>${ic('x')}</span>`;
const me = t => `<div class="bub me">${t}</div>`, ai = t => `<div class="bub ai">${t}</div>`;
const thHead = (ctrl=true) => `<div class="th-h"><span>Assistant</span>${ctrl?ib('right','','Ancrer à droite')+ib('expand','','Agrandir')+ib('x','','Fermer'):''}</div>`;
/** One box: [card | thread] [chips] [row]. action: mic | send | sendoff | stop | none */
function box(o={}){
  const s = Object.assign({text:'', ph:'Demandez, ou « / » pour une action', focus:false, action:'mic', chips:'', top:'', open:false, dot:false, wave:false, hold:false, err:false, off:false, cls:''}, o);
  const act = {mic:ib('mic','p','Dicter'), send:ib('send','p','Envoyer'), sendoff:ib('send','p dis','Envoyer'), stop:ib('stop','p','Arrêter'), none:''}[s.action];
  const field = s.wave ? `<div class="wave">${Array.from({length:30},(_,i)=>`<i style="height:${5+Math.abs(Math.sin(i*1.9))*20}px"></i>`).join('')}</div>`
    : `<div class="fd ${s.text?'':'empty'}">${s.text||s.ph}${s.focus?'<span class="caret"></span>':''}</div>`;
  if (s.hold) return `<div class="bx ${s.cls}"><div class="rw" style="align-items:center">${ib('mic','p','Parler (maintenu)')}<div class="fd" style="display:flex;align-items:center;gap:8px;padding-block:0"><b style="font-weight:500;white-space:nowrap">Relâche pour envoyer</b><div class="wave">${Array.from({length:18},(_,i)=>`<i style="height:${5+Math.abs(Math.sin(i*1.7))*18}px"></i>`).join('')}</div></div></div></div>`;
  const lead = s.wave ? ib('x','o','Annuler') : ib(s.open?'down':'up','','Conversation',s.dot) + ib('clip', s.off?'o dis':'o', 'Joindre');
  return `<div class="bx ${s.focus?'focus':''} ${s.err?'err':''} ${s.off?'off':''} ${s.cls}">${s.top?`<div class="sec">${s.top}</div>`:''}${s.chips?`<div class="chips">${s.chips}</div>`:''}<div class="rw">${lead}${field}${s.wave?ib('stop','p','Finir la dictée'):act}</div></div>`;
}
const stage = (inner, min=0) => `<div class="st" ${min?`style="min-height:${min}px"`:''}>${inner}</div>`;
const working = (t='Lecture releve-janvier.pdf · 12 lignes sur 40') => `<div class="hd"><span class="spin"></span><span>${t}</span></div>`;
const replyTop = `<div class="hd"><span class="ok">${ic('check')}</span><span><b>Terminé</b> · releve-janvier.pdf</span></div><div class="clamp">Le relevé de janvier compte 40 lignes, toutes rapprochées. Deux écarts sont notés dans ecarts-janvier.csv. Rien d'autre à faire pour janvier. Une quatrième ligne que la carte coupe.</div><div class="chs"><span class="chip">${ic('file')}ecarts-janvier.csv</span></div>`;
const rows = n => Array.from({length:n},(_,i)=>`<div class="rowi"><span>Écriture ${i+1}</span><span>${(i+1)*12},00 €</span></div>`).join('');
const side = (items=['Dossiers','À traiter','Clients'], on=0, app='Compta fictive') => `<div class="sb"><b>${app}</b>${items.map((x,i)=>`<span class="${i===on?'on':''}">${x}</span>`).join('')}</div>`;
function desk({bottom='', right='', content=rows(9), title='Dossier Cèdre', sb=side()}={}){
  return `<div class="dsk">${sb}<div class="cl"><div class="ah"><span>${title}</span></div><div class="ct">${content}</div>${bottom?`<div class="bt">${bottom}</div>`:''}</div>${right}</div>`;
}
const rcol = (title, body, foot='', ctrls='') => `<div class="rc"><div class="rh"><span>${title}</span>${ctrls}</div><div class="rb">${body}</div>${foot?`<div class="rf">${foot}</div>`:''}</div>`;
const kbRows = [['a','z','e','r','t','y','u','i','o','p'],['q','s','d','f','g','h','j','k','l','m'],['⇧','w','x','c','v','b','n','⌫'],['123','espace','Envoyer']];
const kb = `<div class="kb" role="img" aria-label="Clavier du téléphone">${kbRows.map(r=>`<div>${r.map(k=>`<b class="${k.length>1?'w':''}">${k}</b>`).join('')}</div>`).join('')}</div>`;
function phone(dock, {keyboard=false, tabs=true, title='Dossier Cèdre', body=rows(13), full=''}={}){
  if (full) return `<div class="ph"><div class="nt"></div>${full}<div class="hm"><i></i></div></div>`;
  return `<div class="ph"><div class="nt"></div><div class="ah">${title}</div><div class="bd">${body}</div>${dock?`<div class="dk">${dock}</div>`:''}${keyboard?kb:''}${tabs&&!keyboard?'<div class="tb"><span class="on">Dossiers</span><span>À traiter</span><span>Clients</span></div>':''}${keyboard?'':'<div class="hm"><i></i></div>'}</div>`;
}
const fill = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
