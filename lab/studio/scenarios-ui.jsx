// The scenario list in the empty chat and the "next step" strip. Scenarios are data (scenarios/*.mjs, served by /api/studio): the page
// only lists them, starts the one a person clicks and suggests the following step. It knows nothing about any scenario's content.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DownloadIcon, LayersIcon, ListChecksIcon } from 'lucide-react';
import { unavailableReason } from './scenario-availability.mjs';

export { unavailableReason };

/** The empty chat: what the agent can do here, as scenarios grouped by topic. Disabled ones say why. */
export function ScenarioList({ scenarios, variants, variant, onStart }) {
  const groups = [...new Set(scenarios.map(scenario => scenario.group))];
  return <div data-testid="scenario-list" className="mx-auto flex h-full w-full max-w-2xl flex-col gap-5 overflow-y-auto px-4 py-6">
    <header className="space-y-1 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-2xl border border-border bg-muted/50 text-muted-foreground"><ListChecksIcon className="size-5" strokeWidth={1.5} aria-hidden="true" /></span>
      <h3 className="m-0 text-lg font-semibold tracking-tight">Try a scenario</h3>
      <p className="m-0 text-sm text-muted-foreground">One agent, {variant.title}: {variant.description} Pick something to try, or just type.</p>
    </header>
    {groups.map(group => <section key={group} data-testid="scenario-group" aria-label={group} className="space-y-2">
      <h4 className="m-0 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h4>
      <ul className="m-0 grid list-none gap-2 p-0">
        {scenarios.filter(scenario => scenario.group === group).map(scenario => {
          const reason = unavailableReason(scenario, variant, variants);
          return <li key={scenario.id}><button type="button" disabled={Boolean(reason)} data-testid="scenario" data-scenario={scenario.id} data-available={reason ? 'false' : 'true'} title={reason ?? undefined}
            onClick={() => onStart(scenario)}
            className="flex min-h-11 w-full cursor-pointer flex-col gap-0.5 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background">
            <span className="text-sm font-medium">{scenario.title}</span>
            <span className="text-xs text-muted-foreground">{scenario.description}</span>
            {reason && <span data-testid="scenario-reason" className="text-xs text-muted-foreground italic">{reason}</span>}
          </button></li>;
        })}
      </ul>
    </section>)}
  </div>;
}

/** After a scenario started: the next thing a person would type, one tap away. Upload steps link the file to attach. */
export function NextStep({ scenario, step, onUse, fixture }) {
  return <div data-testid="scenario-next" data-scenario={scenario.id} className="flex flex-wrap items-center gap-2 text-sm">
    <LayersIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="font-medium">{scenario.title}</span>
    <span className="text-muted-foreground">next:</span>
    {step.upload && <a href={fixture} data-testid="scenario-fixture" download={step.upload.name} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted/60"><DownloadIcon className="size-3.5" aria-hidden="true" />{step.upload.name}</a>}
    <button type="button" data-testid="scenario-use" onClick={onUse} className="inline-flex min-h-8 max-w-full cursor-pointer items-center rounded-md border border-border px-2 text-left text-xs hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
      <span className="truncate">{step.upload ? 'Attach it, then ask: ' : ''}{step.prompt}</span>
    </button>
  </div>;
}

const NOOP = () => () => {};
/** How many messages the person has typed in the open conversation (a background subagent's report is a user message too, but not typed). */
export function useTyped(controller) {
  const view = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller?.getSnapshot().view, () => undefined);
  return useMemo(() => (view?.entries ?? []).reduce((count, entry) => count + (entry.model ?? []).filter(message => message.role === 'user'
    && !(typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? part.text : '').join('')).startsWith('[Background subagent #')).length, 0), [view]);
}

const recall = key => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; } };
const remember = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* optional convenience */ } };
// An attached file leaves its mention in the composer: the prompt follows it.
const appendTo = (text, prompt) => text ? `${text}${text.endsWith(' ') ? '' : ' '}${prompt}` : prompt;
const plain = step => !step.mention && !step.upload;
const fillFor = step => step.mention ? `@${step.mention} ${step.prompt}` : step.prompt;

/**
 * The scenario behaviour both pages share (the studio and the Cloudflare recipe): starting one from the empty chat and suggesting the
 * next step. `typed` counts what the person has typed in the open conversation, so progress needs no state of its own beyond where it began.
 * `seed(scenario)` puts the scenario's files in place and `openPanel(scenario)` opens its tab, for hosts that have them.
 * Returns the `emptyState` and `decisions` props for PiChat.
 */
export function useScenarioRun({ storageKey, scenarios, variants, variant, controller, conversationId, typed, seed, openPanel, fixtureUrl }) {
  const [run, setRun] = useState(() => recall(storageKey));
  useEffect(() => { remember(storageKey, run); }, [storageKey, run]);
  const scenario = run && run.conversation === conversationId ? scenarios.find(candidate => candidate.id === run.id) : undefined;
  const sent = Math.max(0, typed - (run?.baseline ?? 0));
  const next = scenario ? scenario.steps[sent] : undefined;
  // Suggest after the first message, or from the start when the first step needs a mention or an upload (nothing is sent for it).
  const suggestion = scenario && next && (sent >= 1 || !plain(next)) ? next : undefined;
  async function start(item) {
    if (unavailableReason(item, variant, variants)) return;
    if (item.seeds.length && seed) await seed(item);
    setRun({ id: item.id, conversation: conversationId, baseline: typed });
    openPanel?.(item);
    const first = item.steps[0];
    if (!first || !controller) return;
    // A plain prompt is sent at once; a mention is put in the composer for the person to send; an upload waits for the file (see the next-step strip).
    if (first.upload) return;
    controller.setText(fillFor(first));
    if (plain(first)) await controller.send();
  }
  return {
    emptyState: <ScenarioList scenarios={scenarios} variants={variants} variant={variant} onStart={item => { start(item).catch(() => {}); }} />,
    decisions: suggestion ? <NextStep scenario={scenario} step={suggestion} fixture={suggestion.upload ? fixtureUrl?.(scenario, suggestion) : undefined}
      onUse={() => { controller.setText(suggestion.upload ? appendTo(controller.getSnapshot().draft.text, suggestion.prompt) : fillFor(suggestion)); }} /> : undefined,
  };
}
