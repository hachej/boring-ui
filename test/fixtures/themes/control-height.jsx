import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../shadcn/ui/button';
import { Input } from '../../../shadcn/ui/input';
import { Textarea } from '../../../shadcn/ui/textarea';
import { NativeSelect, NativeSelectOption } from '../../../shadcn/ui/native-select';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../../shadcn/ui/select';
import { SidebarProvider, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '../../../shadcn/ui/sidebar';
import { Composer } from '../../../registry/pi-chat/composer.tsx';
import { VoiceMessageButton } from '../../../registry/pi-chat-voice/voice-message.tsx';
import { HeaderActions } from '../../../registry/app-shell/header-actions.tsx';
import { appShellText } from '../../../registry/app-shell/text.ts';
import { InlineQuestion } from '../../../registry/inline-question/inline-question.tsx';

// The controls D-1741 sizes by one token, rendered by the real shared sources and registry blocks with fictional text.
const noop = () => {};
const voice = { phase: 'idle', canStart: true, start: noop, cancel: noop, finish: noop };
const Dot = props => <svg {...props} viewBox="0 0 16 16" aria-hidden="true" />;
const actions = [{ id: 'share', label: 'Share', icon: Dot, onSelect: noop }, { id: 'rename', label: 'Rename', icon: Dot, onSelect: noop }];
function Composers() {
  const ref = useRef(null);
  const [text, setText] = useState('');
  const props = { attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false, onSend: noop, onStop: noop, uploading: false, canAttach: false, fileAccept: '', onPickFiles: noop, textareaRef: ref };
  return <div className="pi-chat flex flex-col gap-2">
    <div data-testid="composer-mic-case"><Composer {...props} text={text} onText={setText} whenEmpty={<VoiceMessageButton voice={voice} />} /></div>
    <div data-testid="composer-send-case"><Composer {...props} text="Plan a fictional picnic" onText={noop} /></div>
  </div>;
}
function App() {
  return <main className="flex flex-col gap-3 p-4" data-testid="root">
    <div className="flex flex-wrap items-center gap-2" data-testid="buttons">
      {['default', 'lg', 'sm', 'xs', 'icon', 'icon-sm', 'icon-xs'].map(size => <Button key={size} size={size} variant="outline" data-testid={`button-${size}`}>{size.startsWith('icon') ? <Dot /> : size}</Button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2" data-testid="fields">
      <Input aria-label="Name" data-testid="field-input" defaultValue="Maple" />
      <Textarea aria-label="Notes" data-testid="field-textarea" defaultValue="Fictional notes" />
      <NativeSelect><NativeSelectOption>One</NativeSelectOption></NativeSelect>
      <NativeSelect size="sm"><NativeSelectOption>Two</NativeSelectOption></NativeSelect>
      <Select defaultValue="a"><SelectTrigger data-testid="field-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">A</SelectItem></SelectContent></Select>
    </div>
    <SidebarProvider><SidebarMenu><SidebarMenuItem><SidebarMenuButton data-testid="sidebar-row">Projects</SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarProvider>
    <div className="flex items-center gap-2" data-testid="header"><HeaderActions actions={actions} compact={false} text={appShellText('en')} prefix="hdr" run={noop} /></div>
    <Composers />
    <InlineQuestion id="q1" kind="question" text="Which fictional plan?" onAnswer={noop} />
  </main>;
}
// A normal root and a 400px frame that sets data-density="compact" (a framed narrow column such as Studio's product-manager chat).
createRoot(document.getElementById('root')).render(<>
  <div data-case="normal"><App /></div>
  <div data-case="compact" data-density="compact" style={{ width: 400 }}><App /></div>
</>);
