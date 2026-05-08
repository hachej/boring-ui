import { describe, expect, it, vi } from "vitest"
import { prepareHtmlPreviewDocument, resolveHtmlPreviewAssetPath, rewriteCssAssetUrls } from "./HtmlViewer"

describe("HtmlViewer asset rewriting", () => {
  it("resolves relative preview assets from the HTML file directory", () => {
    expect(resolveHtmlPreviewAssetPath("pages/index.html", "./styles/site.css")).toBe("pages/styles/site.css")
    expect(resolveHtmlPreviewAssetPath("pages/index.html", "../assets/logo.png")).toBe("assets/logo.png")
    expect(resolveHtmlPreviewAssetPath("pages/index.html", "/global.css")).toBe("global.css")
    expect(resolveHtmlPreviewAssetPath("pages/index.html", "https://example.com/site.css")).toBeNull()
    expect(resolveHtmlPreviewAssetPath("pages/index.html", "../../escape.css")).toBeNull()
  })

  it("rewrites CSS url() references to raw file URLs", () => {
    expect(rewriteCssAssetUrls("body{background:url('../img/bg.png#hero')}", "pages/css/site.css", ""))
      .toBe("body{background:url('/api/v1/files/raw?path=pages%2Fimg%2Fbg.png#hero')}")
  })

  it("inlines linked stylesheets and rewrites stylesheet-relative assets", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/files/raw?path=pages%2Fstyles%2Fsite.css") {
        return new Response(".hero{background:url('../assets/hero.png')}", { status: 200 })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const controller = new AbortController()
    const html = await prepareHtmlPreviewDocument({
      html: '<html><head><link rel="stylesheet" href="styles/site.css"></head><body><img src="assets/logo.png"></body></html>',
      path: "pages/index.html",
      apiBaseUrl: "",
      headers: {},
      signal: controller.signal,
    })

    expect(html).toContain('<style data-boring-html-viewer-href="styles/site.css">')
    expect(html).toContain("url('/api/v1/files/raw?path=pages%2Fassets%2Fhero.png')")
    expect(html).toContain('src="/api/v1/files/raw?path=pages%2Fassets%2Flogo.png"')
  })
})
