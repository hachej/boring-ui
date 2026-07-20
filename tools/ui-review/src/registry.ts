import { validateUiReviewSpec, type UiReviewSpec } from "./core/reviewSpec"
import { workspaceCommandPaletteSpec } from "./review-specs/workspace-command-palette/spec"
import { workspaceComponentBaselinesSpec } from "./review-specs/workspace-component-baselines/spec"

export class UiReviewSpecRegistry {
  readonly #specs = new Map<string, UiReviewSpec>()

  register(spec: UiReviewSpec): this {
    const validated = validateUiReviewSpec(spec)
    if (this.#specs.has(validated.id)) throw new Error(`UI_REVIEW_SPEC_DUPLICATE:${validated.id}`)
    this.#specs.set(validated.id, validated)
    return this
  }

  get(id: string): UiReviewSpec {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`UI_REVIEW_SPEC_ID_INVALID:${id}`)
    const spec = this.#specs.get(id)
    if (!spec) throw new Error(`UI_REVIEW_SPEC_UNKNOWN:${id}`)
    return spec
  }

  ids(): string[] { return [...this.#specs.keys()].sort() }
}

export const uiReviewSpecs = new UiReviewSpecRegistry()
  .register(workspaceCommandPaletteSpec)
  .register(workspaceComponentBaselinesSpec)
export const getUiReviewSpec = (id: string): UiReviewSpec => uiReviewSpecs.get(id)
