# How to cut a release

Building and publishing a release happens through GitHub Actions (`.github/workflows/build.yml`), which runs when a tag matching `v*` is pushed.

## Steps

1. Bump the version in `package.json` (`version` field) and commit the change.
2. Create a tag matching the version from `package.json`, prefixed with `v`:
   ```bash
   git tag v1.2.0
   ```
3. Push the tag — a plain `git push` does not push tags, so do it explicitly:
   ```bash
   git push origin v1.2.0
   ```
   Or push commits and tags together:
   ```bash
   git push --follow-tags
   ```
4. Wait for the workflow to finish in the repo's **Actions** tab. Once the build succeeds, the release with its artifacts (`.dmg` and auto-update files) will appear under **Releases**.

## Rebuilding a release for the same tag

If a release for that tag already exists (e.g. the previous build failed or shipped the wrong artifacts), delete the old release on GitHub first (**Releases** → select the release → trash icon), then re-run the workflow: **Actions** → the relevant run → **Re-run all jobs**.

For cleanliness, avoid reusing a tag — prefer cutting a new version (e.g. `v1.2.1`) instead.
