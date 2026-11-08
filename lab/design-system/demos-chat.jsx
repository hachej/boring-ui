// Components, part 3: the chat parts (attachment, bubble, marker, message, message scroller, trace). The kit's real shadcn/ui components.
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from '@/components/ui/attachment';
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from '@/components/ui/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader } from '@/components/ui/message';
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from '@/components/ui/message-scroller';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { FileIcon, XIcon } from '../../registry/_shared/icons';
import { Demo, Label, groupsOf } from './demo.jsx';

const STATES = ['idle', 'uploading', 'processing', 'error', 'done'];

function Attachments() {
  const { size, orientation } = groupsOf('attachment', 'attachmentVariants');
  const { variant } = groupsOf('attachment', 'attachmentMediaVariants');
  return (
    <Demo names="Attachment AttachmentGroup AttachmentMedia AttachmentContent AttachmentTitle AttachmentDescription AttachmentActions AttachmentAction AttachmentTrigger" title="Attachment">
      <div className="flex flex-col gap-3">
        {orientation.map(direction => (
          <AttachmentGroup key={direction} data-ds-variant={direction}>
            {size.map((sizeName, index) => (
              <Attachment key={sizeName} size={sizeName} orientation={direction} state={STATES[(index * 2) % STATES.length]} data-ds-size={sizeName}>
                <AttachmentMedia variant={variant[index % variant.length]}><FileIcon /></AttachmentMedia>
                <AttachmentContent><AttachmentTitle>report.txt</AttachmentTitle><AttachmentDescription>{direction} {sizeName}</AttachmentDescription></AttachmentContent>
                <AttachmentActions><AttachmentAction aria-label="Remove" size="icon-xs" variant="ghost"><XIcon /></AttachmentAction></AttachmentActions>
                <AttachmentTrigger aria-label={`Open ${sizeName}`} />
              </Attachment>
            ))}
          </AttachmentGroup>
        ))}
        <div className="flex flex-wrap gap-2">
          {STATES.map(state => <Attachment key={state} state={state} data-ds-state={state}><AttachmentContent><AttachmentTitle>{state}</AttachmentTitle></AttachmentContent></Attachment>)}
        </div>
      </div>
    </Demo>
  );
}

function Bubbles() {
  const { variant } = groupsOf('bubble', 'bubbleVariants');
  const { side, align } = groupsOf('bubble', 'bubbleReactionsVariants');
  return (
    <Demo names="Bubble BubbleGroup BubbleContent BubbleReactions" title="Bubble">
      <BubbleGroup className="max-w-md">
        {variant.map(name => <Bubble key={name} variant={name} data-ds-variant={name}><BubbleContent>{name}: a message in the transcript.</BubbleContent></Bubble>)}
        {side.flatMap(sideName => align.map(alignName => (
          <Bubble key={`${sideName}-${alignName}`} data-ds-variant={`${sideName}-${alignName}`}>
            <BubbleContent>Reactions {sideName} {alignName}</BubbleContent>
            <BubbleReactions side={sideName} align={alignName}>+1</BubbleReactions>
          </Bubble>
        )))}
      </BubbleGroup>
    </Demo>
  );
}

function Markers() {
  return (
    <Demo names="Marker MarkerIcon MarkerContent" title="Marker">
      <div className="flex max-w-md flex-col gap-3">
        {groupsOf('marker').variant.map(name => <Marker key={name} variant={name} data-ds-variant={name}><MarkerIcon><FileIcon /></MarkerIcon><MarkerContent>{name}</MarkerContent></Marker>)}
      </div>
    </Demo>
  );
}

function Messages() {
  return (
    <Demo names="Message MessageGroup MessageAvatar MessageContent MessageHeader MessageFooter" title="Message">
      <MessageGroup className="max-w-md">
        {['start', 'end'].map(align => (
          <Message key={align} align={align} data-ds-variant={align}>
            <MessageAvatar><Avatar><AvatarFallback>AB</AvatarFallback></Avatar></MessageAvatar>
            <MessageContent><MessageHeader>Sender</MessageHeader><Bubble><BubbleContent>Aligned {align}.</BubbleContent></Bubble><MessageFooter>10:00</MessageFooter></MessageContent>
          </Message>
        ))}
      </MessageGroup>
    </Demo>
  );
}

function Scrollers() {
  return (
    <Demo names="MessageScrollerProvider MessageScroller MessageScrollerViewport MessageScrollerContent MessageScrollerItem MessageScrollerButton" title="Message scroller">
      <MessageScrollerProvider>
        <MessageScroller className="h-40 max-w-md rounded-md border border-border">
          <MessageScrollerViewport>
            <MessageScrollerContent>
              {Array.from({ length: 10 }, (_, index) => <MessageScrollerItem key={index}><Bubble><BubbleContent>Message {index + 1}</BubbleContent></Bubble></MessageScrollerItem>)}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </Demo>
  );
}

function Traces() {
  return (
    <Demo names="Trace TraceLine TraceIcon TraceTitle TraceDescription TraceCollapsible TraceCollapsibleTrigger TraceCollapsibleContent" title="Trace">
      <div className="flex max-w-md flex-col gap-2">
        {['running', 'pending', 'error'].map(status => (
          <Trace key={status} data-ds-variant={status}>
            <TraceLine status={status} />
            <TraceIcon><FileIcon /></TraceIcon><TraceTitle>Read file</TraceTitle><TraceDescription>{status}</TraceDescription>
          </Trace>
        ))}
        <TraceCollapsible defaultOpen>
          <TraceCollapsibleTrigger><TraceTitle>Details</TraceTitle></TraceCollapsibleTrigger>
          <TraceCollapsibleContent>The tool read three lines.</TraceCollapsibleContent>
        </TraceCollapsible>
        <Label>trace</Label>
      </div>
    </Demo>
  );
}

export function ChatDemos() {
  return <><Attachments /><Bubbles /><Markers /><Messages /><Scrollers /><Traces /></>;
}
