import { BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES } from "../../shared/plugins/manifest"

const CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "navigate-to 'none'",
].join("; ")

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function escapeScriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

export function assertHostedIframeDocumentSize(html: string): void {
  if (byteLength(html) > BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES) {
    throw new Error(`HOSTED_PLUGIN_DOCUMENT_TOO_LARGE: iframe document must be at most ${BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES} bytes`)
  }
}

export function createHostedIframeSrcdoc(html: string, nonce: string): string {
  assertHostedIframeDocumentSize(html)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
  const bootstrap = `<script>(function(){\n` +
    `var nonce=${escapeScriptJson(nonce)};var port=null;var connected=false;var announceTimer=null;\n` +
    `function truncate(value){value=String(value);return value.length>2000?value.slice(0,2000)+'…':value;}\n` +
    `function send(type,payload){try{if(port)port.postMessage(Object.assign({type:type},payload||{}));}catch(e){}}\n` +
    `function announce(){if(connected)return;try{parent.postMessage({type:'boring.hosted-plugin.ready-for-connect',nonce:nonce},'*');}catch(e){}}\n` +
    `announce();announceTimer=setInterval(announce,100);setTimeout(function(){if(announceTimer)clearInterval(announceTimer);},10000);\n` +
    `window.addEventListener('message',function(event){var data=event.data||{};if(data.type!=='boring.hosted-plugin.connect'||data.nonce!==nonce)return;var ports=event.ports||[];if(!ports[0])return;connected=true;if(announceTimer)clearInterval(announceTimer);port=ports[0];send('ready',{});},false);\n` +
    `['log','error'].forEach(function(level){var original=console[level];console[level]=function(){var args=Array.prototype.slice.call(arguments).map(function(v){try{return typeof v==='string'?v:JSON.stringify(v)}catch(e){return String(v)}});send(level,{message:truncate(args.join(' '))});if(original)original.apply(console,arguments);};});\n` +
    `window.addEventListener('error',function(e){send('error',{message:truncate(e.message||'iframe error')});});\n` +
    `window.addEventListener('unhandledrejection',function(e){send('error',{message:truncate((e.reason&&e.reason.message)||String(e.reason||'unhandled rejection'))});});\n` +
    `})();</script>`
  return `<!doctype html><html><head>${meta}${bootstrap}</head><body>${html}</body></html>`
}
