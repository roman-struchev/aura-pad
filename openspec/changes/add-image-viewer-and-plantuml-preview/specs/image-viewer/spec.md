# Spec Delta

## Purpose

Lets users look at image files from their project or from anywhere else on disk inside
AuraPad, instead of hitting a binary-file error and switching to another app.

## ADDED Requirements

### Requirement: Image files open in an image viewer tab
Opening a file whose extension is `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico` or `avif`
(any letter case) from any entry point (tree, quick open, Finder/"Open With", drag and drop,
session restore) SHALL open a tab that shows the image, not the text editor and not a
binary-file error.

#### Scenario: Opening a PNG from the tree
- **WHEN** the user clicks `logo.png` in the file tree
- **THEN** a tab for `logo.png` becomes active and shows the image

#### Scenario: Upper-case extension
- **WHEN** the user opens `PHOTO.JPG`
- **THEN** it opens in the image viewer like `photo.jpg` would

#### Scenario: Restored on relaunch
- **WHEN** an image tab was open when the app quit and the app is started again
- **THEN** the tab is restored and shows the image

### Requirement: Image tabs are read-only
An image tab SHALL never be marked unsaved, autosaved, or written back to disk, and it SHALL
NOT offer actions that act on text: Format, dictation, read aloud, spelling, Work Together
share, Local History and Translate.

#### Scenario: No text actions on an image
- **WHEN** an image tab is active
- **THEN** the file actions toolbar and Find Action offer no Format, dictation, read-aloud,
  spelling, share or Local History entries for it

#### Scenario: Closing never asks to save
- **WHEN** the user closes an image tab
- **THEN** it closes without an unsaved-changes prompt and the file on disk is unchanged

### Requirement: Fit and zoom
The viewer SHALL initially show the whole image, scaled down to fit the pane but never
scaled above its natural size. The user SHALL be able to zoom in and out, return to Fit,
and show the image at 100% (1:1), using toolbar buttons or `Cmd`+mouse wheel / trackpad
pinch. A zoomed image larger than the pane SHALL scroll.

#### Scenario: Large image fits
- **WHEN** a 4000×3000 image is opened in a pane smaller than that
- **THEN** the whole image is visible, scaled down proportionally

#### Scenario: Small image is not blown up
- **WHEN** a 16×16 icon is opened
- **THEN** it is shown at 16×16, not stretched to the pane

#### Scenario: Zoom to 1:1
- **WHEN** the user chooses 1:1 on a fitted large image
- **THEN** the image is shown at its natural pixel size and the pane scrolls

### Requirement: Image information
The viewer SHALL show the image's pixel dimensions, its file size, and the current zoom
percentage.

#### Scenario: Dimensions and size shown
- **WHEN** a 640×480 PNG of 120 KB is open
- **THEN** the viewer shows "640 × 480", the size in KB and the zoom percentage

### Requirement: Transparency is visible
Transparent areas of an image SHALL be drawn over a checkerboard so that they can be told
apart from white or black pixels in every app theme.

#### Scenario: Transparent PNG in the dark theme
- **WHEN** a PNG with a transparent background is opened in the dark theme
- **THEN** the transparent area shows a checkerboard, not the theme's background colour

### Requirement: Live reload from disk
When the open image file changes on disk, the viewer SHALL show the new image without the
user reopening the tab. When the file is deleted, the tab SHALL say the image is no longer
available.

#### Scenario: Screenshot overwritten
- **WHEN** `shot.png` is open and another program writes a new image over it
- **THEN** the viewer shows the new image and its new dimensions

### Requirement: Unreadable images fail in place
An image larger than 10 MB, or one the engine cannot decode, SHALL open a tab that states
why it cannot be shown (with the size for an oversized file) and offers Open in Default App.
The app SHALL NOT show the binary-file error dialog for these extensions.

#### Scenario: Oversized image
- **WHEN** the user opens a 25 MB PNG
- **THEN** the tab says the image is too large to preview (25 MB, limit 10 MB) and offers
  Open in Default App

#### Scenario: Corrupt image
- **WHEN** the user opens a `.png` whose bytes are not a valid image
- **THEN** the tab says the image could not be decoded

### Requirement: SVG preview
An `.svg` file SHALL keep opening as editable text, and SHALL offer the Preview toggle
(`Cmd+Shift+P` and the toolbar eye button) that shows the current buffer, unsaved edits
included, rendered as an image with the same fit/zoom controls. Scripts and external
resources inside the SVG SHALL NOT run or load in the preview.

#### Scenario: Preview an SVG
- **WHEN** the user opens `icon.svg` and toggles Preview
- **THEN** the drawing is shown rendered, and toggling again returns to the source

#### Scenario: Script inside an SVG
- **WHEN** a previewed SVG contains a `<script>` element
- **THEN** the drawing is shown and the script does not run
