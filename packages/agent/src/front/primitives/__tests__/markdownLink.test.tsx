// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rehypeMarkdownLinkActions } from "../markdownLink";
import { MessageResponse } from "../message";

const TEST_URL = "https://github.com/hachej/boring-ui";
const MARKDOWN_LINK = `See the [boring-ui repo](${TEST_URL}) here.`;

const renderMarkdown = (markdown: string) =>
  render(<MessageResponse linkSafety={{ enabled: false }}>{markdown}</MessageResponse>);

const renderedLink = () => screen.getByRole("link", { name: "boring-ui repo" });
const copyButton = () => screen.getByRole("button", { name: "Copy URL" });
const openButton = () => screen.getByRole("button", { name: "Open URL in new tab" });

describe("MessageResponse link affordances (#1395)", () => {
  const clipboardWrite = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: clipboardWrite } });
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clipboardWrite.mockClear();
  });

  it("decorates Streamdown links without replacing their anchor behavior", () => {
    renderMarkdown(MARKDOWN_LINK);

    const anchor = renderedLink();
    expect(anchor.getAttribute("href")).toBe(TEST_URL);
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toContain("noreferrer");
    expect(anchor.className).toContain("wrap-anywhere");
    expect(anchor.getAttribute("data-streamdown")).toBe("link");
    expect(copyButton()).toBeTruthy();
    expect(openButton()).toBeTruthy();
  });

  it("scopes reveal styles to the URL group and blocks pointer events while hidden", () => {
    renderMarkdown(MARKDOWN_LINK);

    const group = document.querySelector('[data-boring-agent-part="chat-url-group"]') as HTMLElement;
    const actions = document.querySelector('[data-boring-agent-part="chat-url-actions"]') as HTMLElement;

    expect(group.className).toContain("group/markdown-link");
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("pointer-events-none");
    expect(actions.className).toContain("group-hover/markdown-link:opacity-100");
    expect(actions.className).toContain("group-hover/markdown-link:pointer-events-auto");
    expect(actions.hasAttribute("node")).toBe(false);
  });

  it("copies the raw markdown href through the canonical clipboard helper", async () => {
    renderMarkdown(MARKDOWN_LINK);
    fireEvent.click(copyButton());

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(TEST_URL));
    await waitFor(() => expect(copyButton().getAttribute("title")).toBe("Copied"));
  });

  it("delegates Open to the original Streamdown link", () => {
    renderMarkdown(MARKDOWN_LINK);
    const anchor = renderedLink();
    const click = vi.spyOn(anchor, "click").mockImplementation(() => undefined);

    fireEvent.click(openButton());

    expect(click).toHaveBeenCalledOnce();
  });

  it("preserves Streamdown linkSafety for Open", async () => {
    const onLinkCheck = vi.fn().mockResolvedValue(true);
    render(
      <MessageResponse linkSafety={{ enabled: true, onLinkCheck }}>
        {MARKDOWN_LINK}
      </MessageResponse>,
    );

    expect(screen.getByRole("button", { name: "boring-ui repo" }).getAttribute("data-streamdown")).toBe("link");
    fireEvent.click(openButton());

    await waitFor(() => expect(onLinkCheck).toHaveBeenCalledWith(TEST_URL));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(TEST_URL, "_blank", "noreferrer"));
  });

  it("retains Streamdown's malicious-URL hardening before decoration", () => {
    renderMarkdown("[bad](javascript:alert(1))");

    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy URL" })).toBeNull();
    expect(screen.getByText(/bad \[blocked\]/)).toBeTruthy();
  });

  it("does not duplicate controls when the decorator is registered more than once", () => {
    render(
      <MessageResponse
        linkSafety={{ enabled: false }}
        rehypePlugins={[rehypeMarkdownLinkActions, rehypeMarkdownLinkActions]}
      >
        {MARKDOWN_LINK}
      </MessageResponse>,
    );

    expect(screen.getAllByRole("button", { name: "Copy URL" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Open URL in new tab" })).toHaveLength(1);
  });

  it("keeps the rehype pipeline stable across streaming token updates", async () => {
    let transformerRuns = 0;
    const probePlugin = () => () => {
      transformerRuns += 1;
    };
    const rehypePlugins = [probePlugin];
    const view = render(
      <MessageResponse rehypePlugins={rehypePlugins}>{"settled block\n\nstream"}</MessageResponse>,
    );
    await waitFor(() => expect(transformerRuns).toBeGreaterThanOrEqual(2));
    transformerRuns = 0;

    view.rerender(
      <MessageResponse rehypePlugins={rehypePlugins}>{"settled block\n\nstreaming"}</MessageResponse>,
    );

    await waitFor(() => expect(transformerRuns).toBe(1));
  });

  it("does not decorate incomplete streaming links", () => {
    render(<MessageResponse>{"[unfinished](https://example.com"}</MessageResponse>);

    expect(screen.queryByRole("button", { name: "Copy URL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open URL in new tab" })).toBeNull();
  });

  it("retains Streamdown's allowedTags sanitize-schema augmentation", () => {
    render(
      <MessageResponse
        allowedTags={{ mention: ["user_id"] }}
        linkSafety={{ enabled: false }}
      >
        {'<mention user_id="123">@agent</mention>'}
      </MessageResponse>,
    );

    const mention = document.querySelector("mention");
    expect(mention?.textContent).toBe("@agent");
    expect(mention?.getAttribute("user_id")).toBe("123");
  });

  it("leaves non-link content untouched", () => {
    renderMarkdown("Just **bold** words, no links at all.");
    expect(screen.queryByRole("button", { name: "Copy URL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open URL in new tab" })).toBeNull();
    expect(screen.getByText(/no links at all/)).toBeTruthy();
  });
});
