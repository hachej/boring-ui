import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AskUserFormSchema } from "../../../shared/types"
import { QuestionCancelButton, QuestionFields, QuestionForm, QuestionFormProvider, QuestionSubmitButton, validateQuestionValues } from "../QuestionForm"

const allFields: AskUserFormSchema = { wireVersion: 1, fields: [
  { type: "text", name: "text", label: "Text", required: true, minLength: 2, pattern: "^[a-z]+$", helpText: "help" },
  { type: "textarea", name: "area", label: "Area" },
  { type: "select", name: "select", label: "Select", options: [{ value: "a", label: "A", description: "desc" }, { value: "b", label: "B" }] },
  { type: "multiselect", name: "multi", label: "Multi", required: true, options: [{ value: "x", label: "X" }], minSelections: 1 },
  { type: "checkbox", name: "check", label: "Check" },
  { type: "radio", name: "radio", label: "Radio", options: [{ value: "r", label: "R" }, { value: "s", label: "S" }] },
  { type: "number", name: "num", label: "Num", min: 1, max: 5, integer: true },
] }

function Form(props: { schema?: AskUserFormSchema; onSubmit?: (values: any) => void; onCancel?: () => void; registry?: any }) {
  return <QuestionFormProvider schema={props.schema} rendererRegistry={props.registry} onSubmit={props.onSubmit} onCancel={props.onCancel}>
    <QuestionForm><QuestionFields /><QuestionSubmitButton /><QuestionCancelButton /></QuestionForm>
  </QuestionFormProvider>
}

describe("QuestionForm primitives", () => {
  it("validates shape and constraints", () => {
    const result = validateQuestionValues(allFields, { text: "1", select: "bad", multi: [], num: 6 })
    expect(result.valid).toBe(false)
    expect(result.errors).toMatchObject({ text: "Must be at least 2 characters.", select: "Choose a valid option.", multi: "This field is required.", num: "Must be at most 5." })
  })

  it("renders every default field with accessible descriptions", async () => {
    render(<Form schema={allFields} />)
    await waitFor(() => expect(screen.getByLabelText(/Text/)).toHaveFocus())
    expect(screen.getByLabelText(/Area/)).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toBeInTheDocument()
    expect(screen.getByLabelText(/X/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Check/)).toBeInTheDocument()
    expect(screen.getByLabelText(/R/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Num/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Text/)).toHaveAttribute("aria-describedby", expect.stringContaining("text-help"))
  })

  it("focuses first invalid field and supports keyboard submit/cancel", async () => {
    const submit = vi.fn()
    const cancel = vi.fn()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<Form schema={allFields} onSubmit={submit} onCancel={cancel} />)
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    await waitFor(() => expect(screen.getByLabelText(/Text/)).toHaveFocus())
    fireEvent.change(screen.getByLabelText(/Text/), { target: { value: "ok" } })
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } })
    fireEvent.click(screen.getByLabelText(/X/))
    fireEvent.change(screen.getByLabelText(/Num/), { target: { value: "2" } })
    fireEvent.keyDown(screen.getByRole("form", { name: "Question form" }), { key: "Enter", ctrlKey: true })
    expect(submit).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole("form", { name: "Question form" }), { key: "Escape" })
    expect(cancel).toHaveBeenCalled()
  })

  it("disables submit until ready and valid", () => {
    render(<QuestionFormProvider status="draft"><QuestionForm><QuestionSubmitButton /></QuestionForm></QuestionFormProvider>)
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled()
  })

  it("supports unsupported fields and renderer override", () => {
    const schema = { wireVersion: 1 as const, fields: [{ type: "future", name: "f", label: "F" } as any] }
    const { rerender } = render(<Form schema={schema} />)
    expect(screen.getByText(/Unsupported question field/)).toBeInTheDocument()
    rerender(<Form schema={schema} registry={{ unsupported: () => <div>Custom unsupported</div> }} />)
    expect(screen.getByText("Custom unsupported")).toBeInTheDocument()
    const textSchema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "t", label: "T" }] }
    rerender(<Form schema={textSchema} registry={{ text: () => <div>Custom text renderer</div> }} />)
    expect(screen.getByText("Custom text renderer")).toBeInTheDocument()
  })

  it("preserves dirty values across patches and shows hint", () => {
    const initial = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "text", label: "Old" }] }
    const patched = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "text", label: "New" }] }
    const { rerender } = render(<Form schema={initial} />)
    fireEvent.change(screen.getByLabelText(/Old/), { target: { value: "mine" } })
    rerender(<Form schema={patched} />)
    expect(screen.getByDisplayValue("mine")).toBeInTheDocument()
    expect(screen.getByText(/Agent updated/)).toBeInTheDocument()
  })
})
