import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { CheckIcon as LucideCheck } from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { CheckIcon, ArrowUpIcon } from '../../../registry/_shared/icons';
import type { BlockIcon } from '../../../registry/button/actions';
import type { ChatIcons } from '../../../registry/pi-chat/labels';

const ref = createRef<SVGSVGElement>();
const native = <CheckIcon ref={ref} size={16} weight="bold" mirrored aria-label="Done" className="brand" strokeWidth={2} data-icon="inline-start" />;
const svgProps: ComponentProps<'svg'> = { ref, role: 'img', width: 18, height: 18, onClick: event => event.currentTarget.focus() };
const spread = <ArrowUpIcon {...svgProps} />;
const oldIcon: LucideIcon = LucideCheck;
const oldProps: LucideProps = { size: 18, absoluteStrokeWidth: true, ref };
const old = <LucideCheck {...oldProps} />;
const custom: BlockIcon = props => <svg {...props} viewBox="0 0 31 31" />;
const choices: readonly BlockIcon[] = [CheckIcon, oldIcon, custom];
const overrides: Partial<ChatIcons> = { send: custom, stop: oldIcon, history: CheckIcon };
void [native, spread, old, choices, overrides];
