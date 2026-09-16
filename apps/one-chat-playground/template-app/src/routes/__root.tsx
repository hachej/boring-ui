import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "App" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="font-medium">Not found</h1>
      <p className="text-muted-foreground text-sm">
        The requested page could not be found.
      </p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Anti-flash: a dev server regenerates the stylesheet after every save; keep the
            page invisible until the stylesheet has applied (1.5s safety cap). */}
        <style>{"html:not([data-css-ready]){visibility:hidden}"}</style>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var d=document.documentElement;function r(){d.setAttribute('data-css-ready','')}var l=document.querySelector('link[rel=stylesheet]');if(!l||l.sheet){r();return}l.addEventListener('load',r);l.addEventListener('error',r);setTimeout(r,1500)})();",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
