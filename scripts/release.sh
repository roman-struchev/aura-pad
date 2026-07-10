#!/usr/bin/env bash
# Bumps the minor version, commits it, tags it, and pushes.
# Pushing a tag matching v* triggers .github/workflows/build.yml,
# which builds and publishes the release.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

VERSION="$(npm version minor --no-git-tag-version | tr -d 'v')"
TAG="v$VERSION"

git add package.json package-lock.json
git commit -m "chore: release $TAG"
git tag "$TAG"
git push origin HEAD "$TAG"

echo "Pushed commit and tag $TAG. Watch the Actions tab for the build."
