#!/bin/bash
# Installs the latest AuraPad release on macOS or Linux.
#
# macOS: downloading with curl (instead of a browser) means the app never gets
# the com.apple.quarantine attribute, so Gatekeeper doesn't block the unsigned
# build with the "AuraPad is damaged" dialog. Installs into /Applications.
#
# Linux: installs the AppImage into ~/.local/bin and adds a desktop entry.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/roman-struchev/aura-pad/main/scripts/install.sh | bash
set -euo pipefail

REPO="roman-struchev/aura-pad"
APP_NAME="AuraPad"

# Prints the download URL of the latest release asset matching the given
# filename suffix (e.g. ".dmg" or ".AppImage").
asset_url() {
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -oE "\"browser_download_url\": *\"[^\"]+\\${1}\"" \
    | grep -oE 'https://[^"]+' \
    | head -n 1
}

TMP_DIR=$(mktemp -d)
MOUNT_POINT=""
cleanup() {
  [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

install_macos() {
  local install_dir="/Applications"

  echo "Looking up the latest ${APP_NAME} release..."
  local dmg_url
  dmg_url=$(asset_url ".dmg")
  if [ -z "$dmg_url" ]; then
    echo "Error: no .dmg asset found in the latest release of ${REPO}." >&2
    exit 1
  fi

  echo "Downloading ${dmg_url##*/}..."
  curl -fL --progress-bar -o "$TMP_DIR/${APP_NAME}.dmg" "$dmg_url"

  echo "Mounting disk image..."
  MOUNT_POINT=$(hdiutil attach "$TMP_DIR/${APP_NAME}.dmg" -nobrowse -readonly \
    | grep -oE '/Volumes/.+' | tail -n 1)

  local app_src
  app_src=$(find "$MOUNT_POINT" -maxdepth 1 -name '*.app' | head -n 1)
  if [ -z "$app_src" ]; then
    echo "Error: no .app found inside the disk image." >&2
    exit 1
  fi

  # Quit a running copy so the binary isn't replaced under it: ask politely
  # via AppleScript, give it a few seconds, then force-kill as a last resort.
  if pgrep -xq "$APP_NAME"; then
    echo "Quitting running ${APP_NAME}..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -xq "$APP_NAME" || break
      sleep 0.5
    done
    pkill -x "$APP_NAME" 2>/dev/null || true
  fi

  echo "Installing to ${install_dir}/${APP_NAME}.app..."
  rm -rf "${install_dir:?}/${APP_NAME}.app"
  ditto "$app_src" "${install_dir}/${APP_NAME}.app"

  hdiutil detach "$MOUNT_POINT" -quiet
  MOUNT_POINT=""

  # Belt and suspenders: strip quarantine in case the script itself was saved
  # from a browser or the attribute got inherited some other way.
  xattr -cr "${install_dir}/${APP_NAME}.app" 2>/dev/null || true

  echo "Done. Launching ${APP_NAME}..."
  open "${install_dir}/${APP_NAME}.app"
}

install_linux() {
  local bin_dir="$HOME/.local/bin"
  local target="$bin_dir/${APP_NAME}.AppImage"

  echo "Looking up the latest ${APP_NAME} release..."
  local appimage_url
  appimage_url=$(asset_url ".AppImage")
  if [ -z "$appimage_url" ]; then
    echo "Error: no .AppImage asset found in the latest release of ${REPO}." >&2
    exit 1
  fi

  echo "Downloading ${appimage_url##*/}..."
  curl -fL --progress-bar -o "$TMP_DIR/${APP_NAME}.AppImage" "$appimage_url"
  chmod +x "$TMP_DIR/${APP_NAME}.AppImage"

  # Stop a running copy so the binary isn't replaced under it.
  if pgrep -x aurapad >/dev/null 2>&1; then
    echo "Stopping running ${APP_NAME}..."
    pkill -x aurapad 2>/dev/null || true
    sleep 1
  fi

  echo "Installing to ${target}..."
  mkdir -p "$bin_dir"
  mv -f "$TMP_DIR/${APP_NAME}.AppImage" "$target"

  # Best effort: pull the icon out of the AppImage and register a launcher
  # entry so the app shows up in the applications menu.
  local icon_arg=""
  (cd "$TMP_DIR" && "$target" --appimage-extract '.DirIcon' >/dev/null 2>&1) || true
  if [ -f "$TMP_DIR/squashfs-root/.DirIcon" ]; then
    mkdir -p "$HOME/.local/share/icons"
    cp -L "$TMP_DIR/squashfs-root/.DirIcon" "$HOME/.local/share/icons/aurapad.png" 2>/dev/null \
      && icon_arg="Icon=$HOME/.local/share/icons/aurapad.png"
  fi
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/aurapad.desktop" <<EOF
[Desktop Entry]
Name=${APP_NAME}
Exec=${target} %F
Type=Application
Terminal=false
Categories=Utility;TextEditor;Development;
${icon_arg}
EOF

  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) echo "Note: $bin_dir is not in your PATH; launch via the applications menu or the full path." ;;
  esac

  echo "Done. Launching ${APP_NAME}..."
  nohup "$target" >/dev/null 2>&1 &
}

case "$(uname)" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *)
    echo "Error: unsupported OS '$(uname)'. On Windows, download the -setup.exe from" >&2
    echo "https://github.com/${REPO}/releases/latest instead." >&2
    exit 1
    ;;
esac
