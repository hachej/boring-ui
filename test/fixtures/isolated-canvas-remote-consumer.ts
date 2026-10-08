import { Type } from '@earendil-works/pi-ai';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import type { CanvasMountedTools as MountedCanvasTools } from '@hachej/boring-ui-kit/canvas-editor';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';

export function remoteSelectionTool(connection: {
  readonly id: string;
  readonly target: NonNullable<ReturnType<MountedCanvasTools['getTarget']>>;
  readonly select: MountedCanvasTools['select'];
}, authorize: (api: ToolExecutionApi, context: Context) => Promise<boolean>) {
  return createPresentationTool({
    name: `select_canvas_${connection.id.replaceAll('-', '')}`,
    description: 'Select shapes in the captured browser canvas',
    parameters: Type.Object({ shapeIds: Type.Array(Type.String()) }),
    target: connection.target,
    command: connection.select,
    prepareInput: args => ({ shapeIds: args.shapeIds, expiresAt: Date.now() + 5000 }),
    authorize: (_input, _target, api, context) => authorize(api, context),
    formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result.kind === 'unknown'
      ? { kind: 'unknown', reason: result.reason }
      : result) }] }),
  });
}
