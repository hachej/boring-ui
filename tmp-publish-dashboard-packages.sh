#!/bin/sh
set -eu

cd /home/ubuntu/projects/boring-ui-v2-bi-dashboard

for pkg in plugins/generated-pane plugins/data-bridge plugins/bi-dashboard; do
  name=$(node -p "require('./$pkg/package.json').name")
  version=$(node -p "require('./$pkg/package.json').version")

  echo "==> $name@$version"

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "Already published; skipping $name@$version"
    continue
  fi

  pnpm --filter "$name" build

  (
    cd "$pkg"
    tarball=$(pnpm pack 2>&1 | tail -1)
    echo "Publishing $pkg/$tarball"
    npm publish "$tarball" --access public
  )
done

echo "Done. Tarballs were left in each plugin folder."
