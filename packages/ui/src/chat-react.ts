'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { watchConversation } from './run-notifications.js';
import type { NotificationStore, RunNotificationOptions, RunNotificationSource } from './run-notifications.js';

export { createNotificationStore, watchConversation } from './run-notifications.js';
export type { AgentNotification, NewNotification, NotificationKind, NotificationStore, RunNotificationOptions, RunNotificationSource } from './run-notifications.js';

/** The foreground adapter of watchConversation, with the same connected-only transition rules and borrowed lifecycle. */
export function useRunNotifications(controller: RunNotificationSource, store: NotificationStore, options: RunNotificationOptions): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => watchConversation(controller, store, () => latest.current), [controller, store, options.conversationId]);
}
