// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MessageResponse } from "../message";

const renderMarkdown = (md: string) =>
  render(<MessageResponse>{md}</MessageResponse>);

describe("MessageResponse link affordances (#1395)", () => {
  const clipboardWrite = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clipboardWrite.mockClear();
  });

  const link = () => screen.getByRole("link", { name: "boring-ui repo" });
  const copyBtn = () => screen.getByRole("button", { name: "Copy URL" });
  const openBtn = () => screen.getByRole("button", { name: "Open URL in new tab" });

  it("renders hover actions for markdown links without altering the anchor", () => {
    renderMarkdown("See the [boring-ui repo](https://github.com/hachej/boring-ui) here.");

    const a = link();
    expect(a.getAttribute("href")).toBe("https://github.com/hachej/boring-ui");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    // Actions exist in the DOM; visibility is hover/focus-driven CSS.
    expect(copyBtn()).toBeTruthy();
    expect(openBtn()).toBeTruthy();
    expect(document.querySelector('[data-boring-agent-part="chat-url-actions"]')).toBeTruthy();
  });

  it("reveals actions on link hover and focus-within", () => {
    renderMarkdown("See the [boring-ui repo](https://github.com/hachej/boring-ui) here.");
    const group = document.querySelector('[data-boring-agent-part="chat-url-actions"]') as HTMLElement;
    expect(group.className).toContain("opacity-0");

    fireEvent.mouseOver(link());
    fireEvent.mouseEnter(link().closest("span.group")!);
    expect(group.className).toMatch(/group-hover:opacity-100/);

    fireEvent.focus(copyBtn());
    expect(group.className).toMatch(/group-focus-within:opacity-100/);
  });

  it("copies the raw href via the clipboard on Copy click", async () => {
    renderMarkdown("See the [boring-ui repo](https://github.com/hachej/boring-ui) here.");
    fireEvent.click(copyBtn());
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith("https://github.com/hachej/boring-ui"));
    // Copied feedback swaps the icon button's title.
    await waitFor(() => expect((copyBtn() as HTMLButtonElement).title).toBe("Copied"));
  });

  it("opens the raw href in a new tab via the Open action", () => {
    renderMarkdown("See the [boring-ui repo](https://github.com/hachej/boring-ui) here.");
    fireEvent.click(openBtn());

    expect(window.open).toHaveBeenCalledWith(
      "https://github.com/hachej/boring-ui",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("leaves non-link content untouched", () => {
    renderMarkdown("Just **bold** words, no links at all.");
    expect(screen.queryByRole("button", { name: "Copy URL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open URL in new tab" })).toBeNull();
    expect(screen.getByText(/no links at all/)).toBeTruthy();
  });
});
