# D417 implementation evidence

Base: edd50ceb9; implementation commits eea146123, 94c245341, a8d9610c8 plus the final evidence/registry commit. No push, PR mutation or merge.

Latest owner v117 supersedes the earlier visible task-left/file-right layout: native shadcn right overlays stack board → task → wider regular file viewer. Kanban keeps its width underneath. Back/Escape unwind one layer. Host overlayClassName supplies appearance/shadow.

API additions: TaskQuestion answeredBy/answeredAt; TaskRecord files ({path,name?}); onOther, onDiscussQuestion, renderFile(task,file,{onBack,onClose,onShowFile?}), onOpenFile/onShowFile, overlayClassName. Optional task-mentions exports taskMentions({tasks,onOpen,base?}), preserving host file search/kinds and using the existing MentionPicker/composer. Ambient artifacts.autoOpenTasks opts into pending host task-view requests; actual mount/failure reports still decide native acknowledgement.

Questions: open outlined cards first; latest-three bounded question/actor-answer previews, Show all and lazy full-text expansion. One-tap answers never open chat. Discuss posts a task mention into the ONE native conversation; the native scripted tool and one-tap route share a fictional host answer service.

Validation: 51 focused tests pass (public TaskBoard wrapper executes seven component scenarios); strict local example typecheck; nine browser journey steps; registry build/boundary, hooks lint, block lint, design, feature map and repository reachability pass. Selected settled screenshots and native result evidence are alongside this report. Raw evidence: .cache/evidence/d417/.

Limits: no PM pointing/capture/chip or comment store; Montrer reports exact task/path only. Draft chips retain existing removable-only behavior; sent task chips open overlays. Parent owns installed-consumer/full gates and fullscreen viewport-geometry follow-up. Runtime task storage remains host-owned.
