// Chat basics: what any chat must do, with the one standard agent. Streaming, stop, queue and steer, reload during a live answer,
// a full server restart, history. The long essays are there to keep the agent busy while the scenario acts on the chat.
import assert from 'node:assert/strict';

// A long answer that is never a document: the numbers from 1 to n in English words, one per line, in the reply itself.
const essay = (n, _topic, ending) => `Without using tools or artifacts, write the numbers from 1 to ${n} in English words, one per line, directly in the chat.${ending ? ` Then end with the exact line: ${ending}.` : ''}`;

export default [
  {
    id: 'chat-hello', smoke: true, group: 'Chat basics', title: 'Say hello', description: 'A plain streamed answer: no tool call, no panel.',
    steps: [{ prompt: 'Reply with exactly: HELLO-STUDIO' }],
    script: { 0: [{ reasoning: 'The person wants one fixed greeting.', text: 'HELLO-STUDIO' }] },
    expect: [{ reply: /HELLO-STUDIO/ }, { noToolCalls: true }, { panelOpen: false }, { userMessages: 1 }],
  },
  {
    id: 'chat-stop', group: 'Chat basics', title: 'Stop a long answer', description: 'Stop ends a live answer for good, the chat says it was interrupted, and it stays usable.',
    steps: [{ prompt: essay(400, 'lantern festivals', 'LANTERN-END'), wait: false }, { action: 'streaming' }, { action: 'stop' },
      { async run(t) { await t.browser.until('the interrupted state is shown', `!!${t.q('[data-testid=interrupted]')}`, 15000); } },
      { prompt: 'Never mind the numbers. Reply with exactly: AFTER-STOP' }],
    expect: [{ reply: /AFTER-STOP/ }, { replyNot: /LANTERN-END/ }],
  },
  {
    id: 'chat-queue-steer', group: 'Chat basics', title: 'Queue and steer while it works', description: 'Messages sent while busy wait above the composer; edit, remove them, or steer the running answer.',
    steps: [{ prompt: essay(250, 'tide tables'), wait: false }],
    async verify(t) {
      const { browser, say, idle, MESSAGE, logText, SUBMIT, q, qa, dark, pause, clear, button } = t;
      const working = `${SUBMIT}?.dataset.state === 'stop'`;
      const queued = `${qa('[data-testid=queue-item]')}.map(e => [e.dataset.mode, e.querySelector('[data-testid=queue-text]').textContent])`;
      await browser.until('working', working, 30000);
      assert.equal(await browser.evaluate(`!${q('[data-testid=when-busy]')} && !${q('[data-testid=queue]')}`), true, 'while busy the composer has no toggle and nothing is queued yet');
      await say('Second message: reply with exactly: QUEUE-ONE');
      await browser.until('first queued message is visible', `${queued}.length === 1`, 15000);
      await say('Third message: reply with exactly: QUEUE-TWO');
      await browser.until('both queued messages are visible', `${queued}.length === 2`, 15000);
      assert.deepEqual(await browser.evaluate(queued), [['followUp', 'Second message: reply with exactly: QUEUE-ONE'], ['followUp', 'Third message: reply with exactly: QUEUE-TWO']]);
      await browser.until('focus stays in the composer', `${MESSAGE}.value === '' && document.activeElement === ${MESSAGE}`, 5000);
      // The choice is made on the queued message itself: steer now, edit or remove. The composer still has no toggle.
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=queue-item]')}.map(e => ['queue-steer', 'queue-more', 'queue-cancel'].map(id => !!e.querySelector('[data-testid=' + id + ']')))`), [[true, true, true], [true, true, true]]);
      assert.equal(await browser.evaluate(`!${q('[data-testid=when-busy]')}`), true, 'no toggle in the composer');
      // The queue is a slim tab tucked behind the composer's top edge: inset from its sides, the composer overlapping its bottom, edit inside the "…" menu.
      assert.equal(await browser.evaluate(`(() => { const t = ${q('[data-testid=queue]')}.getBoundingClientRect(), c = ${q('[data-testid=composer]')}.getBoundingClientRect(); return t.bottom > c.top && t.bottom - c.top < 20 && t.left > c.left && t.right < c.right && !${q('[data-testid=queue-edit]')}; })()`), true, 'the queue is a tab behind the composer');
      await t.shots('chatui-queue');
      // Edit takes the message back into the composer.
      await browser.click(`${qa('[data-testid=queue-item]')}[1].querySelector('[data-testid=queue-more]')`);
      await browser.until('the menu offers Edit', `!!${q('[data-testid=queue-edit]')}`, 3000);
      await browser.click(q('[data-testid=queue-edit]'));
      await browser.until('the edited message is back in the composer', `${queued}.length === 1 && ${MESSAGE}.value === 'Third message: reply with exactly: QUEUE-TWO'`, 15000);
      await clear();
      await say('Third message again: reply with exactly: QUEUE-TWO');
      await browser.until('queued again', `${queued}.length === 2`, 15000);
      await browser.click(`${qa('[data-testid=queue-item]')}[1].querySelector('[data-testid=queue-cancel]')`);
      await browser.until('cancelled message left the queue', `${queued}.length === 1 && ${queued}[0][1].includes('QUEUE-ONE')`, 15000);
      await browser.until('everything idle', `${idle} && ${queued}.length === 0`, 240000);
      await browser.until('the queued message was answered', `/QUEUE-ONE/.test(${logText}.replace('reply with exactly: QUEUE-ONE', ''))`, 60000);
      const users = await browser.evaluate(t.userMessages);
      assert.ok(users.at(-1).includes('QUEUE-ONE') && !users.some(text => text.includes('QUEUE-TWO')), `the cancelled message never ran: ${users.join(' | ')}`);
      assert.ok(users.some(text => text.includes('numbers from 1')), `the first message ran first: ${users.join(' | ')}`);

      // Steer: "Steer now" on a queued message sends it into the running turn and leaves the person's own draft alone.
      await say(essay(250, 'ferry timetables'));
      await browser.until('working', working, 30000);
      await say('Steer message: stop what you are doing now and reply with exactly: STEER-OK');
      await browser.until('queued', `${queued}.length === 1 && ${queued}[0][0] === 'followUp'`, 15000);
      await browser.type(MESSAGE, 'my own unsent draft');
      await browser.click(`${qa('[data-testid=queue-item]')}[0].querySelector('[data-testid=queue-steer]')`);
      await browser.until('the message left the queue (it is now part of the running turn)', `${queued}.length === 0 || ${queued}[0][0] === 'steer'`, 15000);
      await browser.until('everything idle', `${idle} && ${queued}.length === 0`, 240000);
      assert.equal(await browser.evaluate(`${MESSAGE}.value`), 'my own unsent draft', 'the unsent draft was put back');
      const after = await browser.evaluate(t.userMessages);
      assert.equal(after.filter(text => text.includes('STEER-OK')).length, 1, `the steered message ran exactly once: ${after.join(' | ')}`);
      await browser.until('the steered message was answered', `/STEER-OK/.test(${logText}.replace('reply with exactly: STEER-OK', ''))`, 60000);
      await clear();
      void dark; void pause; void button;
    },
  },
  {
    id: 'chat-send-race', group: 'Chat basics', title: 'Type while a send is confirmed', variants: ['local'],
    description: 'With a slow confirmation, Enter empties the composer at once; the next message is its own message, never merged or lost; a refused one comes back.',
    steps: [{ prompt: essay(250, 'harbour cranes'), wait: false }],
    async verify(t) {
      const { browser, idle, MESSAGE, SUBMIT, q, qa, pause } = t;
      const faults = t.app.submitFaults;
      const working = `${SUBMIT}?.dataset.state === 'stop'`;
      const queued = `${qa('[data-testid=queue-item]')}.map(e => e.querySelector('[data-testid=queue-text]').textContent)`;
      const enter = async text => { await browser.type(MESSAGE, text); await browser.press('Enter'); };
      const sent = [];
      await browser.until('working', working, 30000);
      try {
        for (const delay of [1500, 300]) {
          // The studio holds the answer to every submit for `delay` ms after Pi recorded it (the test hook in server.mjs).
          faults.delayMs = delay;
          const one = `Race one: reply with exactly: RACE-ONE-${delay}`, two = `Race two: reply with exactly: RACE-TWO-${delay}`;
          const before = (await browser.evaluate(queued)).length;
          await enter(one);
          // Typed and sent inside the pending window: Enter emptied the composer at once, so this is a fresh draft and a separate message.
          await enter(two);
          sent.push(one, two);
          await browser.until(`${delay} ms: both messages are queued, each with its own text`, `${queued}.length === ${before + 2}`, 15000)
            .catch(async error => { throw new Error(`${error.message}; queue ${JSON.stringify(await browser.evaluate(queued))}, composer ${JSON.stringify(await browser.evaluate(`${MESSAGE}.value`))}`); });
          assert.deepEqual((await browser.evaluate(queued)).slice(before), [one, two], `${delay} ms: two separate messages in order`);
          assert.equal(await browser.evaluate(`${MESSAGE}.value`), '', `${delay} ms: nothing is left in the composer`);
          // A refused send comes back into the composer, ahead of what was typed meanwhile.
          faults.refuse = 1;
          const three = `Race refused: reply with exactly: RACE-THREE-${delay}`, typed = `typed during refusal ${delay}`;
          await enter(three);
          await browser.type(MESSAGE, typed);
          await browser.until(`${delay} ms: the refusal is reported`, `!!${q('[data-testid=send-blocked]')} || !!${q('[data-testid=send-unknown]')}`, 15000);
          if (await browser.evaluate(`!!${q('[data-testid=send-blocked]')}`)) {
            // A client that knows the host refused it (402 submission-refused): the message is back in the composer, nothing merged into it.
            await browser.until(`${delay} ms: the refused message is back above the new text`, `${MESSAGE}.value === ${JSON.stringify(`${three}\n${typed}`)}`, 5000);
          } else {
            // A client that cannot tell: the message is held for checking, the new text is untouched, and retrying sends it once.
            assert.equal(await browser.evaluate(`${MESSAGE}.value`), typed, `${delay} ms: the text typed meanwhile is a fresh draft`);
            const count = (await browser.evaluate(queued)).length;
            // The streaming answer moves the notice while it renders; a click that missed is repeated (a retry reuses the same request ID).
            for (let attempt = 0; attempt < 4 && await browser.evaluate(`!!${q('[data-testid=send-unknown]')}`); attempt++) {
              await browser.click(`[...document.querySelectorAll('[data-testid=send-unknown] button')].find(b => b.textContent.trim() === 'Retry same request')`);
              await browser.until('the retry is under way', `!${q('[data-testid=send-unknown]')}`, 3000).catch(() => {});
            }
            await browser.until(`${delay} ms: the retried message is queued once`, `!${q('[data-testid=send-unknown]')} && ${queued}.length === ${count + 1}`, 15000);
            assert.equal((await browser.evaluate(queued)).at(-1), three);
            sent.push(three);
          }
          await t.clear();
          assert.equal(faults.refuse, 0);
        }
      } finally { faults.delayMs = 0; faults.refuse = 0; }
      await browser.until('everything idle', `${idle} && ${queued}.length === 0`, 240000);
      await pause(500);
      const users = await browser.evaluate(t.userMessages);
      for (const text of sent) assert.equal(users.filter(user => user === text).length, 1, `sent exactly once, alone: ${text} in ${users.join(' | ')}`);
      assert.ok(!users.some(user => /RACE-.*RACE-/.test(user)), `no merged message: ${users.join(' | ')}`);
    },
  },
  {
    id: 'chat-reload', group: 'Chat basics', title: 'Reload during an answer', description: 'Reloading the page mid-answer keeps the conversation and the answer finishes.',
    steps: [{ prompt: `${essay(200, 'a lighthouse keeper named Placeholder', 'THE END')}`, wait: false }, { action: 'streaming' }, { action: 'reload' }, { action: 'idle' }],
    expect: [{ reply: /THE END/ }, { userMessages: 1 }],
  },
  {
    id: 'chat-restart', group: 'Chat basics', title: 'Restart the server', description: 'A full server restart keeps the transcript and the conversation keeps working.',
    steps: [{ prompt: 'Reply with exactly: READY-AGAIN' }, { action: 'restart' }, { prompt: 'Reply with exactly: BACK-AFTER-RESTART' }],
    expect: [{ reply: /READY-AGAIN/ }, { reply: /BACK-AFTER-RESTART/ }, { userMessages: 2 }],
  },
  {
    id: 'chat-history', group: 'Chat basics', title: 'History of conversations', description: 'The sessions pane: past conversations with title and time, search, New, switching; History pages the earlier records.',
    steps: [{ prompt: 'Reply with exactly: ENTER-OK' }],
    async verify(t) {
      const { browser, logText, q, qa, pause, history, dark } = t;
      const current = await history.current();
      await history.open();
      await browser.until('two or more conversations, the open one titled by its first message', `${qa('[data-testid=conversation-row]')}.length >= 2 && /ENTER-OK/.test(${q('[data-testid=conversation-row][data-active=true]')}?.innerText ?? '')`, 20000);
      const rows = await history.rows();
      assert.equal(rows.filter(row => row.active).length, 1, 'exactly one conversation is marked');
      assert.equal(rows.find(row => row.active).id, current);
      assert.equal(await browser.evaluate(`${q('[data-testid=conversation-row][data-active=true]')}.getAttribute('aria-current')`), 'true');
      assert.match(rows.find(row => row.active).time, /Current/);
      assert.ok(rows.filter(row => !row.active).every(row => row.time === '' || /^(now|\d+[mhd]|Yesterday|[A-Z][a-z]{2} \d+)$/.test(row.time)), `relative times: ${JSON.stringify(rows)}`);
      await pause(300);
      await t.shots('chatui-history');
      void dark;
      // The pane is docked beside the chat on a desktop.
      assert.equal(await browser.evaluate(`${q('[data-testid=conversations]')}.dataset.drawer`), 'false');
      // Search narrows the list by title; no match says so.
      await history.search('enter-ok');
      await browser.until('search filtered', `${qa('[data-testid=conversation-row]')}.length >= 1 && ${qa('[data-testid=conversation-row]')}.every(row => /ENTER-OK/i.test(row.innerText))`, 5000);
      await history.search('zzzz-no-such');
      await browser.until('no match message', `${q('[data-testid=conversations-empty]')}?.textContent.includes('No conversation matches')`, 5000);
      await browser.screenshot('chatui-history-empty.png');
      await history.search('');
      await browser.until('the whole list again', `${qa('[data-testid=conversation-row]')}.length >= 2`, 5000);
      // Selecting another conversation switches the chat; the list marks it.
      const other = (await (async () => { await history.open(); const list = await history.rows(); await history.close(); return list; })()).find(row => !row.active);
      await history.select(other.id);
      assert.equal(await history.current(), other.id);
      await history.open();
      assert.equal(await browser.evaluate(`${q('[data-testid=conversation-row][data-active=true]')}.dataset.conversationId`), other.id);
      await history.close();
      await history.select(current);
      await browser.until('the earlier conversation is back', `/ENTER-OK/.test(${logText})`, 15000);
      // New conversation from the list; the earlier one stays selectable.
      const before = await history.count();
      await history.create();
      assert.equal(await history.count(), before + 1);
      await history.select(current);
      // The earlier records of the open conversation: the chat header's History (the list itself is the sessions pane).
      await browser.click(q('[data-testid=history-open]'));
      await browser.until('the read-only earlier records panel', `!!${q('[data-testid=history]')}`, 10000);
      await browser.click(q('[aria-label="Return to active conversation"]'));
      await browser.until('back to the transcript', `!${q('[data-testid=history]')}`, 5000);
    },
  },
  {
    id: 'chat-manage', group: 'Chat basics', title: 'Manage conversations', requires: ['conversation-management'], description: 'Rename, search by the last message, archive, fork from a reply and delete: the list is kept by the server in Pi.',
    steps: [{ prompt: 'Reply with exactly: LANTERN-FIRST' }, { prompt: 'Reply with exactly: QUARTZFOUNTAIN' }],
    async verify(t) {
      const { browser, logText, q, qa, idle, say, history, pause } = t;
      const row = id => `${qa('[data-testid=conversation-row]')}.find(row => row.dataset.conversationId === ${JSON.stringify(String(id))})`;
      const rowAction = (id, action) => `${row(id)}?.parentElement.querySelector('[data-testid=${action}]')`;
      const ids = () => browser.evaluate(`${qa('[data-testid=conversation-row]')}.map(row => row.dataset.conversationId)`);
      const search = async text => {
        await browser.evaluate(`(() => { const e = ${q('[data-testid=conversation-search]')}; e.focus(); e.select(); })()`);
        await browser.press('Backspace');
        if (text) await browser.type(q('[data-testid=conversation-search]'), text);
        await pause(400);
        await browser.until('the search has answered', `${q('[data-testid=conversations] [aria-busy]')} === null`, 10000);
      };
      const first = await history.current();
      // A second chat.
      await history.create();
      await say('Reply with exactly: SECOND-CHAT');
      await browser.until('the second chat answered', `/SECOND-CHAT/.test(${logText}) && ${idle}`, 20000);
      const second = await history.current();
      assert.notEqual(second, first);
      // Rename the first one from the list.
      await history.open();
      await browser.until('both chats are listed', `!!${row(first)} && !!${row(second)}`, 10000);
      await browser.click(rowAction(first, 'conversation-rename'));
      await browser.until('the name field', `!!${q('[data-testid=conversation-rename-input]')}`, 5000);
      await browser.evaluate(`(() => { const e = ${q('[data-testid=conversation-rename-input]')}; e.focus(); e.select(); })()`);
      await browser.press('Backspace');
      await browser.type(q('[data-testid=conversation-rename-input]'), 'Amber plans');
      await browser.press('Enter');
      await browser.until('the new name is listed', `${row(first)}?.innerText.includes('Amber plans')`, 10000);
      // Search on the server finds it by a word of its last message (the title does not have it).
      await search('quartzfountain');
      assert.deepEqual(await ids(), [first], 'the last message matches, nothing else');
      await t.shots('chat-manage-search');
      await search('');
      // Archive hides it; the Archived filter shows it.
      await history.close();
      await history.select(first);
      await history.open();
      await browser.click(rowAction(first, 'conversation-archive'));
      await browser.until('the archived chat leaves the list', `!${row(first)} && !!${row(second)}`, 10000);
      await browser.click(q('[data-testid=conversations-archived]'));
      await browser.until('it is under Archived', `!!${row(first)}`, 10000);
      await browser.click(q('[data-testid=conversations-archived]'));
      await history.close();
      // Fork from the first reply of the open (archived) chat: a new chat with the history up to that reply.
      await browser.until('the first chat is shown', `/QUARTZFOUNTAIN/.test(${logText}) && ${idle}`, 15000);
      await browser.click(`${qa('[data-testid=fork-reply]')}[0]`);
      await browser.until('the fork is open', `${q('[data-testid=studio-main]')}.dataset.conversation !== ${JSON.stringify(first)} && ${q('[data-testid=connection]')}?.dataset.state === 'connected' && /LANTERN-FIRST/.test(${logText})`, 20000);
      assert.doesNotMatch(await browser.evaluate(logText), /QUARTZFOUNTAIN/, 'the fork stops at the chosen reply');
      const fork = await history.current();
      await history.open();
      await browser.until('the fork is listed with a derived title', `${row(fork)}?.innerText.includes('Amber plans (fork)')`, 10000);
      // Delete removes it from the list and the chat moves to another conversation.
      await browser.click(rowAction(fork, 'conversation-delete'));
      await browser.click(rowAction(fork, 'conversation-delete-confirm'));
      await browser.until('the fork is gone', `!${row(fork)}`, 10000);
      await history.close();
      await browser.until('another conversation is open', `${q('[data-testid=studio-main]')}.dataset.conversation !== ${JSON.stringify(fork)}`, 10000);
      const listed = await t.api(`/api/variants/${await browser.evaluate(`${q('.studio')}.dataset.variant`)}/conversations?archived=all`).then(response => response.json());
      assert.ok(!listed.conversations.some(item => String(item.id) === fork), 'the server no longer lists the deleted fork');
      assert.ok(listed.conversations.some(item => String(item.id) === first && item.archived && item.title === 'Amber plans'), 'the renamed chat is archived, not deleted');
    },
  },
];
