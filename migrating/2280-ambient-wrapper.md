- **`pi-ambient`: `AmbientChat` is deprecated; the floating bar is the one composer (`FloatingComposer` of `app-shell`).** `AmbientChat` keeps its props and now renders `FloatingComposer` when every prop you gave is one the composer takes (the same bar, strip, conversation window above it, round icon, grip and place remembered per app; on a phone the bottom sheet). Its toasts for background conversations are the composer's notices (the same `createNotificationStore` and `watchConversation` feed them; `onStateChange` and a controlled `state` follow the bar, the window and the icon as `bar`, `expanded` and `minimized`). A prop the composer does not take yet keeps the bar on the old window, so nothing breaks: `embedded`, `artifactPanel`, `artifacts`, `headerTools`, `headerActions`, `renderComposer`, `composerLayout`, `onDock`, `onOpenFull`, `onFeedback`, `autoDismissMs`, `maxToasts`, `className`, `systemNotifications`. What changes on the composer: the bar's markup is the shell's (`composer-floating`, `composer-icon`, notices `notice*`; the `ambient-*` test ids stay only on the old window), the place is remembered under `boring-ui:sidebar-composer-*` (the first load starts at the bottom right, `storageKey` names the app), `storage` is ignored, an error toast stays until dismissed and one notice shows at a time, and a notice's action is the new label `openShort` (« Open »). Installing `pi-ambient` now also installs `app-shell`, so the app needs the shadcn components `app-shell` lists (sidebar, avatar, drawer, dropdown-menu). `AgentNotifications` and the browser-notify helpers are deprecated too; `createNotificationStore` stays (it is the kit's). Before:

  ```tsx
  <AmbientChat controller={controller} actions={actions} state={state} onStateChange={setState} notifications={store} variant="surface" />
  ```

  After (the same, on the one composer; `chatProps` takes what `AmbientChat` took beside `controller`):

  ```tsx
  <FloatingComposer agent={{ controller, chatProps: { actions } }} appId="my-site" notices={notices} />
  ```

  `notices` is the shell's `AppShellNotice[]`, newest first; build it from your store's items. New on `FloatingComposer`: `notices` and `children` (rendered inside its layer, so a host can read `useAgentLayer()`).
