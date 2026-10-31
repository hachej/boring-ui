'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmSend } from './confirm-send';
import type { SendActions } from './confirm-send';
import type { OutreachLabels } from './outreach-labels';
import { alreadySent, DAILY_SENDS, footerReady, sentToday } from './outreach-model';
import type { OutgoingMessage, OutreachData, OutreachDraft, OutreachProfile, OutreachRecipient, SendLogRow } from './outreach-model';

export interface OutreachActions extends SendActions {
  readonly onSaveProfile: (profile: OutreachProfile) => Promise<void>;
}
export interface OutreachPanelProps extends OutreachActions {
  readonly data: OutreachData;
  readonly drafts: readonly OutreachDraft[];
  readonly recipients: readonly OutreachRecipient[];
  /** The time to count the day's quota against; the app passes the host's clock. */
  readonly now: number;
  readonly labels: OutreachLabels;
}

function Footer({ profile, onSave, labels }: { profile: OutreachProfile; onSave: (p: OutreachProfile) => Promise<void>; labels: OutreachLabels }) {
  const [value, setValue] = useState(profile);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof OutreachProfile) => (e: React.ChangeEvent<HTMLInputElement>) => setValue({ ...value, [key]: e.target.value });
  const save = async () => { setBusy(true); try { await onSave(value); } finally { setBusy(false); } };
  return <Card>
    <CardHeader><CardTitle>{labels.footerTitle}</CardTitle><CardDescription>{labels.footerHint}</CardDescription></CardHeader>
    <CardContent>
      <FieldGroup>
        <Field><FieldLabel htmlFor="outreach-name">{labels.name}</FieldLabel><Input id="outreach-name" value={value.name} maxLength={200} onChange={set('name')} /></Field>
        <Field><FieldLabel htmlFor="outreach-company">{labels.company}</FieldLabel><Input id="outreach-company" value={value.company} maxLength={200} onChange={set('company')} /></Field>
        <Field>
          <FieldLabel htmlFor="outreach-postal">{labels.postal}</FieldLabel>
          <Input id="outreach-postal" value={value.postal} maxLength={200} onChange={set('postal')} />
          <FieldDescription>{footerReady(value) ? '' : labels.footerMissing}</FieldDescription>
        </Field>
        <Button disabled={busy || !footerReady(value)} onClick={save}>{labels.saveFooter}</Button>
      </FieldGroup>
    </CardContent>
  </Card>;
}

interface RecipientsProps {
  readonly recipients: readonly OutreachRecipient[];
  readonly sent: ReadonlySet<string>;
  readonly ready: boolean;
  readonly onPick: (r: OutreachRecipient) => void;
  readonly labels: OutreachLabels;
}

function Recipients({ recipients, sent, ready, onPick, labels }: RecipientsProps) {
  if (!recipients.length) return <p className="text-sm text-muted-foreground">{labels.noRecipients}</p>;
  return <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{labels.recipient}</TableHead>
        <TableHead>{labels.link}</TableHead>
        <TableHead><span className="sr-only">{labels.send}</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {recipients.map((r) => <TableRow key={r.email}>
        <TableCell>{r.email}{sent.has(r.email) && <> <Badge variant="secondary">{labels.alreadySent}</Badge></>}</TableCell>
        <TableCell>{r.ref}</TableCell>
        <TableCell className="text-end"><Button size="sm" disabled={!ready} aria-label={`${labels.send} ${r.email}`} onClick={() => onPick(r)}>{labels.send}</Button></TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;
}

function SendLog({ log, labels }: { log: readonly SendLogRow[]; labels: OutreachLabels }) {
  return <Card>
    <CardHeader><CardTitle>{labels.logTitle}</CardTitle></CardHeader>
    <CardContent>
      {log.length ? <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.when}</TableHead>
            <TableHead>{labels.recipient}</TableHead>
            <TableHead>{labels.draft}</TableHead>
            <TableHead>{labels.link}</TableHead>
            <TableHead>{labels.status}</TableHead>
            <TableHead>{labels.messageId}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {log.map((r) => <TableRow key={r.id}>
            <TableCell>{labels.formatTime(r.at)}</TableCell>
            <TableCell>{r.to}</TableCell>
            <TableCell>{r.draft}</TableCell>
            <TableCell>{r.ref}</TableCell>
            <TableCell>{labels.statuses[r.status] ?? r.status}</TableCell>
            <TableCell className="max-w-48 truncate">{r.messageId ?? ''}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table> : <p className="text-sm text-muted-foreground">{labels.logEmpty}</p>}
    </CardContent>
  </Card>;
}

/** Outreach: the footer identity, the drafts and recipients, the confirm-to-send dialog and the send log. Presentation only: the host sends (env.outreach). */
export function OutreachPanel(props: OutreachPanelProps) {
  const { data, drafts, recipients, labels } = props;
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? '');
  const [message, setMessage] = useState<OutgoingMessage | null>(null);
  if (!data.available) return <Empty><EmptyHeader><EmptyTitle>{labels.outreachTitle}</EmptyTitle><EmptyDescription>{labels.unavailable}</EmptyDescription></EmptyHeader></Empty>;
  const draft = drafts.find((d) => d.id === draftId) ?? drafts[0];
  const left = DAILY_SENDS - sentToday(data.log, props.now);
  const pick = (r: OutreachRecipient) => draft && setMessage({ to: r.email, draft: draft.id, subject: draft.subject, text: draft.text, ref: r.ref });
  return <div className="flex flex-col gap-4" data-testid="outreach">
    <Footer profile={data.profile} onSave={props.onSaveProfile} labels={labels} />
    <Card>
      <CardHeader><CardTitle>{labels.outreachTitle}</CardTitle><CardDescription>{labels.outreachHint} {labels.quota(left, DAILY_SENDS)}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft ? <>
          <Field>
            <FieldLabel htmlFor="outreach-draft">{labels.draft}</FieldLabel>
            <NativeSelect id="outreach-draft" value={draft.id} onChange={(e) => setDraftId(e.target.value)}>
              {drafts.map((d) => <NativeSelectOption key={d.id} value={d.id}>{d.id}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Recipients recipients={recipients} sent={alreadySent(data.log, draft.id)} ready={footerReady(data.profile) && left > 0} onPick={pick} labels={labels} />
        </> : <Empty><EmptyHeader><EmptyTitle>{labels.noDrafts}</EmptyTitle><EmptyDescription>{labels.noDraftsDescription}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
    </Card>
    <SendLog log={data.log} labels={labels} />
    <ConfirmSend message={message} labels={labels} onClose={() => setMessage(null)} onPrepare={props.onPrepare} onSend={props.onSend} />
  </div>;
}
