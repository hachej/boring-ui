import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { Button } from "../button"
import { Badge } from "../badge"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "../card"
import { Checkbox } from "../checkbox"
import { Input } from "../input"
import { Label } from "../label"
import { Separator } from "../separator"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../dialog"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../alert-dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../tabs"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../select"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../tooltip"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../popover"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "../sheet"
import { ScrollArea } from "../scroll-area"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../dropdown-menu"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
} from "../command"

const origResizeObserver = globalThis.ResizeObserver
const origScrollIntoView = Element.prototype.scrollIntoView

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = () => {}
})

afterAll(() => {
  globalThis.ResizeObserver = origResizeObserver
  Element.prototype.scrollIntoView = origScrollIntoView
})

// --- 1. Button ---
describe("Button", () => {
  it("renders", () => {
    render(<Button>Click</Button>)
    expect(screen.getByRole("button", { name: "Click" })).toBeInTheDocument()
  })

  it("renders variants", () => {
    render(<Button variant="destructive">Del</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "destructive")
  })

  it("renders sizes", () => {
    render(<Button size="sm">S</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "sm")
  })

  it("handles disabled", () => {
    render(<Button disabled>No</Button>)
    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("fires click callback", async () => {
    const user = userEvent.setup()
    let clicked = false
    render(<Button onClick={() => { clicked = true }}>Go</Button>)
    await user.click(screen.getByRole("button"))
    expect(clicked).toBe(true)
  })
})

// --- 2. Badge ---
describe("Badge", () => {
  it("renders variants", () => {
    const { rerender } = render(<Badge>Default</Badge>)
    expect(screen.getByText("Default")).toBeInTheDocument()
    rerender(<Badge variant="secondary">Sec</Badge>)
    expect(screen.getByText("Sec")).toHaveClass("bg-secondary")
    rerender(<Badge variant="destructive">Bad</Badge>)
    expect(screen.getByText("Bad")).toHaveClass("bg-destructive")
    rerender(<Badge variant="outline">Out</Badge>)
    expect(screen.getByText("Out")).toHaveClass("text-foreground")
  })
})

// --- 3. Card ---
describe("Card", () => {
  it("renders header, content, footer", () => {
    render(
      <Card>
        <CardHeader><CardTitle>Title</CardTitle></CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>
    )
    expect(screen.getByText("Title")).toBeInTheDocument()
    expect(screen.getByText("Body")).toBeInTheDocument()
    expect(screen.getByText("Foot")).toBeInTheDocument()
  })
})

// --- 4. Checkbox ---
describe("Checkbox", () => {
  it("renders and toggles", async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="agree" />)
    const cb = screen.getByRole("checkbox")
    expect(cb).not.toBeChecked()
    await user.click(cb)
    expect(cb).toBeChecked()
  })

  it("handles disabled", () => {
    render(<Checkbox disabled aria-label="nope" />)
    expect(screen.getByRole("checkbox")).toBeDisabled()
  })

  it("calls onCheckedChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox aria-label="agree" onCheckedChange={onChange} />)
    await user.click(screen.getByRole("checkbox"))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

// --- 5. Input ---
describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="Type here" />)
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument()
  })

  it("accepts typed input and calls onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input placeholder="Type" onChange={onChange} />)
    const input = screen.getByPlaceholderText("Type")
    await user.type(input, "hello")
    expect(input).toHaveValue("hello")
    expect(onChange).toHaveBeenCalled()
  })

  it("handles disabled and readonly", () => {
    const { rerender } = render(<Input disabled />)
    expect(screen.getByRole("textbox")).toBeDisabled()
    rerender(<Input readOnly />)
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly")
  })
})

// --- 6. Label ---
describe("Label", () => {
  it("renders with htmlFor", () => {
    render(<Label htmlFor="name">Name</Label>)
    const label = screen.getByText("Name")
    expect(label).toHaveAttribute("for", "name")
  })
})

// --- 7. Separator ---
describe("Separator", () => {
  it("renders horizontal", () => {
    const { container } = render(<Separator />)
    const sep = container.querySelector('[data-slot="separator"]')
    expect(sep).toBeInTheDocument()
    expect(sep).toHaveAttribute("data-orientation", "horizontal")
  })

  it("renders vertical", () => {
    const { container } = render(<Separator orientation="vertical" />)
    const sep = container.querySelector('[data-slot="separator"]')
    expect(sep).toHaveAttribute("data-orientation", "vertical")
  })
})

// --- 8. Dialog ---
describe("Dialog", () => {
  it("opens on trigger and renders title/description", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Title")).toBeInTheDocument()
    expect(screen.getByText("Desc")).toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Title")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByText("Title")).not.toBeInTheDocument()
    })
  })

  it("has accessible dialog role and focus moves into dialog", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
          <button>Inside</button>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByText("Open"))
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it("closes on overlay click", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    const overlay = document.querySelector("[data-slot='dialog-overlay']")
    expect(overlay).toBeTruthy()
    await user.click(overlay as HTMLElement)
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })
})

// --- 9. AlertDialog ---
describe("AlertDialog", () => {
  it("renders action and cancel", async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )
    await user.click(screen.getByText("Delete"))
    expect(screen.getByText("Sure?")).toBeInTheDocument()
    expect(screen.getByText("Cancel")).toBeInTheDocument()
    expect(screen.getByText("Confirm")).toBeInTheDocument()
  })

  it("closes on cancel click (onCancel)", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )
    await user.click(screen.getByText("Delete"))
    await user.click(screen.getByText("Cancel"))
    expect(onCancel).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText("Sure?")).not.toBeInTheDocument()
    })
  })

  it("fires action callback (onAction)", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )
    await user.click(screen.getByText("Delete"))
    await user.click(screen.getByText("Confirm"))
    expect(onAction).toHaveBeenCalled()
  })

  it("has alertdialog role when open", async () => {
    const user = userEvent.setup()
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    )
    await user.click(screen.getByText("Delete"))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })
})

// --- 10. Tabs ---
describe("Tabs", () => {
  it("switches content and respects defaultValue", async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>
    )
    expect(screen.getByText("Content A")).toBeInTheDocument()
    await user.click(screen.getByText("Tab B"))
    expect(screen.getByText("Content B")).toBeInTheDocument()
  })

  it("calls onValueChange", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Tabs defaultValue="a" onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>
    )
    await user.click(screen.getByText("Tab B"))
    expect(onValueChange).toHaveBeenCalledWith("b")
  })

  it("supports keyboard navigation (arrow keys)", async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>
    )
    screen.getByText("Tab A").focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByText("Tab B")).toHaveFocus()
  })
})

// --- 11. Select ---
describe("Select", () => {
  it("renders trigger with placeholder", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(screen.getByText("Pick")).toBeInTheDocument()
  })

  it("renders combobox role", () => {
    render(
      <Select>
        <SelectTrigger aria-label="choice">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(screen.getByRole("combobox")).toBeInTheDocument()
  })

  it("disabled trigger is not interactive", () => {
    render(
      <Select disabled>
        <SelectTrigger aria-label="choice">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(screen.getByRole("combobox")).toBeDisabled()
  })
})

// --- 12. Tooltip ---
describe("Tooltip", () => {
  it("renders trigger", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Info</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    expect(screen.getByText("Hover")).toBeInTheDocument()
  })

  it("shows tooltip role on hover and links via aria-describedby", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    const trigger = screen.getByText("Hover me")
    await user.hover(trigger)
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toBeInTheDocument()
    })
    expect(trigger).toHaveAttribute("aria-describedby")
  })

  it("tooltip content has aria-describedby linkage", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
    const trigger = screen.getByText("Hover me")
    await user.hover(trigger)
    await waitFor(() => {
      const tooltipId = trigger.getAttribute("aria-describedby")
      expect(tooltipId).toBeTruthy()
      const tooltip = document.getElementById(tooltipId!)
      expect(tooltip).toBeInTheDocument()
      expect(tooltip).toHaveAttribute("role", "tooltip")
    })
  })
})

// --- 13. Popover ---
describe("Popover", () => {
  it("opens on trigger", async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Pop content</PopoverContent>
      </Popover>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Pop content")).toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Pop content</PopoverContent>
      </Popover>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Pop content")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByText("Pop content")).not.toBeInTheDocument()
    })
  })
})

// --- 14. Sheet ---
describe("Sheet", () => {
  it("opens on trigger", async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Sheet")).toBeInTheDocument()
  })

  it("opens from specified side", async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Left Sheet</SheetTitle>
          <SheetDescription>From left</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    await user.click(screen.getByText("Open"))
    const content = document.querySelector("[data-slot='sheet-content']")
    expect(content).toBeTruthy()
    expect(content).toHaveClass("left-0")
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    await user.click(screen.getByText("Open"))
    expect(screen.getByText("Sheet")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByText("Sheet")).not.toBeInTheDocument()
    })
  })

  it("has dialog role and ARIA attributes when open", async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    await user.click(screen.getByText("Open"))
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute("aria-describedby")
  })
})

// --- 15. ScrollArea ---
describe("ScrollArea", () => {
  it("renders children", () => {
    render(<ScrollArea>Scrollable</ScrollArea>)
    expect(screen.getByText("Scrollable")).toBeInTheDocument()
  })

  it("renders viewport with data-slot", () => {
    const { container } = render(
      <ScrollArea style={{ height: 100 }}>
        <div style={{ height: 500 }}>Tall content</div>
      </ScrollArea>
    )
    expect(container.querySelector("[data-slot='scroll-area-viewport']")).toBeInTheDocument()
  })
})

// --- 16. DropdownMenu ---
describe("DropdownMenu", () => {
  it("opens on trigger and renders items", async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByText("Menu"))
    expect(screen.getByText("Item 1")).toBeInTheDocument()
    expect(screen.getByText("Item 2")).toBeInTheDocument()
  })

  it("calls onSelect on item click", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Item A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByText("Menu"))
    await user.click(screen.getByText("Item A"))
    expect(onSelect).toHaveBeenCalled()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByText("Menu"))
    expect(screen.getByText("Item 1")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByText("Item 1")).not.toBeInTheDocument()
    })
  })
})

// --- 17. Command ---
describe("Command", () => {
  it("renders with input and groups", () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Fruits">
            <CommandItem>Apple</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Vegs">
            <CommandItem>Carrot</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument()
    expect(screen.getByText("Apple")).toBeInTheDocument()
    expect(screen.getByText("Carrot")).toBeInTheDocument()
    expect(screen.getByText("Fruits")).toBeInTheDocument()
    expect(screen.getByText("Vegs")).toBeInTheDocument()
  })

  it("filters items on input", async () => {
    const user = userEvent.setup()
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup>
            <CommandItem>Apple</CommandItem>
            <CommandItem>Banana</CommandItem>
            <CommandItem>Cherry</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    expect(screen.getByText("Apple")).toBeInTheDocument()
    expect(screen.getByText("Banana")).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText("Search..."), "app")
    await waitFor(() => {
      expect(screen.getByText("Apple")).toBeInTheDocument()
      expect(screen.queryByText("Banana")).not.toBeInTheDocument()
    })
  })

  it("shows empty state when no match", async () => {
    const user = userEvent.setup()
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup>
            <CommandItem>Apple</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    await user.type(screen.getByPlaceholderText("Search..."), "zzz")
    await waitFor(() => {
      expect(screen.getByText("No results")).toBeInTheDocument()
    })
  })

  it("selects item with Enter", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandGroup>
            <CommandItem onSelect={onSelect} value="apple">Apple</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
    const input = screen.getByPlaceholderText("Search...")
    await user.click(input)
    await user.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalled()
  })
})
