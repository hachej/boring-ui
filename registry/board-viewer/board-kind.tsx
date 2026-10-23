'use client';

import { lazy } from 'react';
import { LayoutDashboardIcon } from 'lucide-react';
import type { ArtifactKind } from '../pi-artifacts/artifact';
import type { BoardHostProps } from './board-props';

const BoardViewer = lazy(() => import('./board-viewer').then(module => ({ default: module.BoardViewer })));

/** An opt-in artifact kind. Its client and authenticated receipt identity belong to the host's selected workspace. The viewer loads on first open. */
export function createBoardKind(host: BoardHostProps): ArtifactKind {
  return { match: target => /\.board\.json$/i.test(target.resource.path), label: 'Board', icon: LayoutDashboardIcon,
    renderer: ({ artifact, text, revision, pinned }) => <BoardViewer {...host} target={artifact.target} text={text} revision={revision} pinned={pinned} /> };
}
