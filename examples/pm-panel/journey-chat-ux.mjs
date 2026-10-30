// Local fictional native PM regression: reopen, question answer from plain composer, outage retry. 390×844.
import { mkdirSync } from 'node:fs';
import { launch, q, pause } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';
const app = await startPmPanel({oneLine:true});
const evidence = process.env.PM_SHOTS ?? '.cache/evidence/pm-panel/chat-ux';
mkdirSync(evidence, { recursive: true });
const browser = await launch('about:blank', { evidence });
try {
 await browser.emulate('phone');
 await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await browser.send('Page.navigate',{url:app.url});
 await browser.until('account',`!!${q('[data-testid=account-button]')}`,20000);
 await browser.tap(q('[data-testid=account-button]')); await pause(150);
 await browser.evaluate(`(() => { const original=window.fetch; window.fetch=(input,init)=> { const url=typeof input==='string'?input:input.url; if(new URL(url,location.href).pathname.endsWith('/api/pm/agent')) { window.fetch=original; return Promise.reject(new Error('Fictional internal stack')); } return original(input,init); }; })()`);
 await browser.tap(q('[data-testid=account-improve]'));
 await browser.until('initial failure offers retry', `!!${q('[data-testid=pm-connect-retry]')}`,15000);
 if(await browser.evaluate(`document.body.textContent.includes('internal stack')`)) throw new Error('Raw acquisition error leaked');
 await browser.screenshot('after-connect-outage.png');
 await browser.tap(q('[data-testid=pm-connect-retry]'));
 await browser.until('composer',`!!${q('[data-testid=composer-input]')}`,15000);
 await browser.tap(q('[data-testid=pm-show]'));
 await browser.until('point at the meal card', `!!${q('[data-testid=pm-strip]')}`,5000);
 await browser.tap(q('[data-testid=gauge]'));
 await browser.tap(q('[data-testid=pm-done]'));
 await browser.evaluate(`(() => { const editor=${q('[data-testid=composer-input]')}; editor.focus(); const range=document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
 await browser.send('Input.insertText', { text: ' Mettez les protéines avant les calories.' });
 await browser.tap(q('[data-testid=composer-submit]'));
 await browser.until('reply',`!!${q('[data-testid=pm-reply]')}`,20000);
 await pause(500);
 await browser.screenshot(`after-reply.png`);
 await browser.tap(q('[data-testid=pm-close]'));
 await browser.tap(q('[data-testid=account-button]')); await pause(150);
 await browser.tap(q('[data-testid=account-improve]')); await pause(300);
 await browser.screenshot(`after-reopened.png`);
 {
  await browser.type(q('[data-testid=composer-input]'), 'Montrez-moi deux maquettes pour la carte repas.');
  await browser.tap(q('[data-testid=composer-submit]'));
  await browser.until('pending native question',`!!${q('[data-testid=question-option]')}`,20000);
  await browser.screenshot('after-pending-question.png');
  const sent = app.submits.length;
  await browser.evaluate(`(() => { const original=window.fetch; window.fetch=(input,init)=> { const url=typeof input==='string'?input:input.url; if(new URL(url,location.href).searchParams.get('op')==='answer') { window.fetch=original; return Promise.reject(new Error('Fictional offline')); } return original(input,init); }; })()`);
  await browser.type(q('[data-testid=composer-input]'), "Piste B · calories d'abord");
  await browser.tap(q('[data-testid=composer-submit]'));
  await browser.until('retryable answer error',`document.body.textContent.includes('Votre texte est conservé')`);
  if(await browser.evaluate(`${q('[data-testid=composer-input]')}.value`) !== "Piste B · calories d'abord") throw new Error('Lost answer draft');
  await browser.screenshot('after-answer-outage.png');
  await browser.tap(q('[data-testid=composer-submit]'));
  await browser.until('native answer',`!!${q('[data-testid=question-card][data-state=answered]')}`,20000);
  if(app.submits.length !== sent) throw new Error('Plain answer created a second submission');
  await browser.screenshot('after-native-answer.png');
 }
 console.log(await browser.evaluate(`({mode:${q('[data-testid=pm-panel]')}.dataset.mode,tools:document.querySelectorAll('[data-testid=activity]').length,reply:!!${q('[data-testid=pm-reply]')},overflow:document.documentElement.scrollWidth>innerWidth})`));
} finally { await browser.close(); await app.close(); }
