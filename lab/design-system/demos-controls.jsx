// Components, part 1: controls and form rows. Every demo renders the kit's real shadcn/ui components; variants and sizes come from their cva blocks.
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Label as FormLabel } from '@/components/ui/label';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PlusIcon, SearchIcon } from '../../registry/_shared/icons';
import { Demo, Label, groupsOf } from './demo.jsx';

function Buttons() {
  const { variant, size } = groupsOf('button');
  const plain = size.filter(name => !name.startsWith('icon') && name !== 'inline');
  const icons = size.filter(name => name.startsWith('icon'));
  return (
    <Demo names="Button" title="Button">
      <div className="flex flex-col gap-2">
        {variant.map(name => (
          <div key={name} data-ds-variant={name} className="flex flex-wrap items-center gap-2">
            <Label>{name}</Label>
            {plain.map(sizeName => <Button key={sizeName} variant={name} size={sizeName}>{sizeName}</Button>)}
            {icons.map(sizeName => <Button key={sizeName} variant={name} size={sizeName} aria-label={`${name} ${sizeName}`}><PlusIcon /></Button>)}
          </div>
        ))}
      </div>
      <p className="max-w-prose" data-ds-size="inline">Sentence with an inline action: read the <Button variant="link" size="inline">release notes</Button> before you upgrade.</p>
    </Demo>
  );
}

function Groups() {
  return (
    <Demo names="ButtonGroup ButtonGroupText ButtonGroupSeparator" title="Button group">
      <div className="flex flex-wrap gap-4">
        {groupsOf('button-group').orientation.map(orientation => (
          <ButtonGroup key={orientation} orientation={orientation} data-ds-variant={orientation}>
            <Button variant="outline">Left</Button>
            <ButtonGroupSeparator />
            <Button variant="outline">Middle</Button>
            <ButtonGroupText>{orientation}</ButtonGroupText>
          </ButtonGroup>
        ))}
      </div>
    </Demo>
  );
}

function Badges() {
  return (
    <Demo names="Badge" title="Badge">
      <div className="flex flex-wrap items-center gap-2">
        {groupsOf('badge').variant.map(name => <Badge key={name} variant={name} data-ds-variant={name}>{name}</Badge>)}
      </div>
    </Demo>
  );
}

function Inputs() {
  return (
    <Demo names="Input Textarea Label" title="Input, Textarea and Label">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1"><FormLabel htmlFor="ds-input">Label</FormLabel><Input id="ds-input" placeholder="Input" /></div>
        <Input aria-label="Invalid input" aria-invalid="true" defaultValue="Invalid" />
        <Input aria-label="Disabled input" disabled defaultValue="Disabled" />
        <Textarea aria-label="Textarea" placeholder="Textarea" />
        <Textarea aria-label="Code textarea" variant="code" defaultValue={'{ "kind": "code", "tab": 2 }'} data-ds-variant="code" />
      </div>
    </Demo>
  );
}

function InputGroups() {
  const { align } = groupsOf('input-group', 'inputGroupAddonVariants');
  const { size } = groupsOf('input-group', 'inputGroupButtonVariants');
  return (
    <Demo names="InputGroup InputGroupAddon InputGroupInput InputGroupTextarea InputGroupText InputGroupButton" title="Input group">
      <div className="grid gap-3 sm:grid-cols-2">
        {align.map(name => (
          <InputGroup key={name} data-ds-variant={name}>
            {name.startsWith('block') ? <InputGroupTextarea aria-label={name} placeholder={name} /> : <InputGroupInput aria-label={name} placeholder={name} />}
            <InputGroupAddon align={name}><InputGroupText><SearchIcon />{name}</InputGroupText></InputGroupAddon>
          </InputGroup>
        ))}
        <InputGroup>
          <InputGroupInput aria-label="With buttons" placeholder="Button sizes" />
          <InputGroupAddon align="inline-end">
            {size.map(name => <InputGroupButton key={name} size={name} aria-label={name} data-ds-size={name}>{name.startsWith('icon') ? <PlusIcon /> : name}</InputGroupButton>)}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </Demo>
  );
}

function Choices() {
  return (
    <Demo names="Checkbox Switch RadioGroup RadioGroupItem" title="Checkbox, Switch and Radio">
      <div className="flex flex-wrap items-center gap-4">
        <Checkbox aria-label="Unchecked" /><Checkbox aria-label="Checked" defaultChecked /><Checkbox aria-label="Disabled" disabled />
        {['default', 'sm'].map(size => <Switch key={size} size={size} aria-label={`Switch ${size}`} defaultChecked data-ds-size={size} />)}
        <Switch aria-label="Switch off" /><Switch aria-label="Switch disabled" disabled />
        <RadioGroup defaultValue="one" aria-label="Radio" className="flex flex-row gap-3">
          <RadioGroupItem value="one" aria-label="One" /><RadioGroupItem value="two" aria-label="Two" /><RadioGroupItem value="three" disabled aria-label="Three" />
        </RadioGroup>
      </div>
    </Demo>
  );
}

function Toggles() {
  const { variant, size } = groupsOf('toggle');
  return (
    <Demo names="Toggle ToggleGroup ToggleGroupItem" title="Toggle and ToggleGroup">
      <div className="flex flex-col gap-2">
        {variant.map(name => (
          <div key={name} data-ds-variant={name} className="flex flex-wrap items-center gap-2">
            <Label>{name}</Label>
            {size.map(sizeName => <Toggle key={sizeName} variant={name} size={sizeName} aria-label={`${name} ${sizeName}`}><PlusIcon />{sizeName}</Toggle>)}
            <ToggleGroup variant={name} defaultValue={['a']}>
              <ToggleGroupItem value="a" aria-label="A">A</ToggleGroupItem><ToggleGroupItem value="b" aria-label="B">B</ToggleGroupItem>
            </ToggleGroup>
          </div>
        ))}
      </div>
    </Demo>
  );
}

function NativeSelects() {
  return (
    <Demo names="NativeSelect NativeSelectOption NativeSelectOptGroup" title="Native select">
      <div className="flex flex-wrap gap-3">
        {['default', 'sm'].map(size => (
          <NativeSelect key={size} size={size} aria-label={`Native select ${size}`} data-ds-size={size}>
            <NativeSelectOption value="a">Draft</NativeSelectOption>
            <NativeSelectOptGroup label="Group"><NativeSelectOption value="b">Review</NativeSelectOption></NativeSelectOptGroup>
          </NativeSelect>
        ))}
      </div>
    </Demo>
  );
}

function Keys() {
  return (
    <Demo names="Kbd KbdGroup" title="Kbd">
      <KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup>
    </Demo>
  );
}

function Statuses() {
  return (
    <Demo names="Progress ProgressTrack ProgressIndicator ProgressLabel ProgressValue Spinner Skeleton Separator" title="Progress, Spinner, Skeleton and Separator">
      <div className="flex flex-col gap-3">
        <Progress value={40} className="max-w-sm"><ProgressLabel>Upload</ProgressLabel><ProgressValue /></Progress>
        <div className="flex items-center gap-3"><Spinner /><Skeleton className="h-4 w-40" /><Skeleton className="size-8 rounded-full" /></div>
        <Separator /><div className="flex h-5 items-center gap-3">One<Separator orientation="vertical" />Two</div>
      </div>
    </Demo>
  );
}

/** Field in each orientation, then labelled rows flat and bordered. */
function Fields() {
  const { orientation } = groupsOf('field');
  return (
    <Demo
      names="Field FieldLabel FieldContent FieldTitle FieldDescription FieldGroup FieldSet FieldLegend FieldSeparator FieldError"
      title="Field"
      note="Orientations vertical, horizontal and responsive; then labelled rows, flat and bordered."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {orientation.map(name => (
          <Field key={name} orientation={name} data-ds-variant={name}>
            <FieldLabel htmlFor={`ds-field-${name}`}>{name}</FieldLabel>
            <FieldContent><Input id={`ds-field-${name}`} placeholder={name} /><FieldDescription>Help text.</FieldDescription></FieldContent>
          </Field>
        ))}
      </div>
      <FieldSet>
        <FieldLegend>Set legend</FieldLegend>
        <FieldGroup>
          <Field data-invalid="true"><FieldLabel htmlFor="ds-bad">Invalid</FieldLabel><Input id="ds-bad" aria-invalid="true" defaultValue="x" /><FieldError>Required.</FieldError></Field>
          <FieldSeparator>or</FieldSeparator>
        </FieldGroup>
      </FieldSet>
      <div className="grid gap-4 sm:grid-cols-2">
        {['flat', 'bordered'].map(variant => (
          <FieldGroup key={variant} className="gap-0" data-ds-variant={variant}>
            {['Notifications', 'Digest'].map((title, index) => (
              <FieldLabel key={title} variant={variant}>
                <Field orientation="horizontal">
                  <FieldContent><FieldTitle>{title} ({variant})</FieldTitle><FieldDescription>A labelled row.</FieldDescription></FieldContent>
                  {index === 0 ? <Switch aria-label={`${title} ${variant}`} defaultChecked /> : <Checkbox aria-label={`${title} ${variant}`} />}
                </Field>
              </FieldLabel>
            ))}
          </FieldGroup>
        ))}
      </div>
    </Demo>
  );
}

export function ControlDemos() {
  return <><Buttons /><Groups /><Badges /><Inputs /><InputGroups /><Choices /><Toggles /><NativeSelects /><Keys /><Statuses /><Fields /></>;
}
