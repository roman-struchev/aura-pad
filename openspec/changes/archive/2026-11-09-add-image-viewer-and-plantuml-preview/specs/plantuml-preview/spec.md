# Spec Delta

## Purpose

Lets users see the diagram a PlantUML source file describes, rendered inside the editor and
entirely on their own machine, while they keep editing its text.

## ADDED Requirements

### Requirement: PlantUML files are previewable
Files with the extensions `.puml`, `.plantuml`, `.pu` and `.iuml` SHALL open as editable text
and SHALL offer the Preview toggle (`Cmd+Shift+P`, the toolbar eye button, the tree's hover
eye icon and the Find Action entry), the same way Markdown files do.

#### Scenario: Toggle preview on a .puml file
- **WHEN** the user opens `sequence.puml` and toggles Preview
- **THEN** the rendered diagram replaces the source, and toggling again returns to the source

### Requirement: Rendering is fully local
Rendering a diagram SHALL NOT send the diagram source, or anything else, over the network
and SHALL NOT require Java, Graphviz or any other program to be installed.

#### Scenario: Offline rendering
- **WHEN** the machine has no network connection and no Java installed, and the user
  previews a sequence diagram and a class diagram
- **THEN** both diagrams are rendered

### Requirement: Preview follows the buffer
The preview SHALL render the tab's current text, unsaved edits included, and SHALL update
after the user edits the source and returns to the preview, or when the file changes on disk.

#### Scenario: Edit then preview
- **WHEN** the user adds `Bob -> Carol : hi` to an open diagram and toggles Preview
- **THEN** the rendered diagram contains the `Carol` participant

### Requirement: Rendering is asynchronous and latest-wins
The rendering engine SHALL be loaded only when a diagram is first previewed, not at app
startup. While a diagram renders the preview SHALL show that rendering is in progress, and a
render started for older text SHALL NOT replace the result for newer text.

#### Scenario: First preview of the session
- **WHEN** the app starts and no diagram has been previewed yet
- **THEN** the PlantUML engine has not been loaded

#### Scenario: Older render finishes last
- **WHEN** the text changes while a render for the previous text is still running
- **THEN** the preview ends up showing the diagram for the newest text

### Requirement: Errors are shown in place
When the source cannot be rendered, the preview SHALL show the error PlantUML reports
(including the line it points at, when it gives one) instead of a blank pane or a dialog.

#### Scenario: Syntax error
- **WHEN** the user previews a file containing `@startuml` followed by an invalid line
- **THEN** the preview shows PlantUML's error message for it

#### Scenario: Missing @startuml
- **WHEN** the file has diagram lines but no `@startuml`/`@enduml` pair
- **THEN** the preview still renders the diagram, as if the pair had been written

### Requirement: Diagram follows the app theme
The diagram SHALL be rendered in PlantUML's dark mode when the app theme is dark or Monokai
and in its normal mode for light and Solarized, unless the source itself sets a `!theme` or
skin parameters, which take precedence.

#### Scenario: Dark app theme
- **WHEN** the app theme is dark and the user previews a diagram with no theme of its own
- **THEN** the diagram is drawn with light lines and text on a dark background

### Requirement: Diagram can be zoomed
The rendered diagram SHALL fit the pane initially and SHALL offer the same zoom controls as
the image viewer (zoom in/out, Fit, 1:1).

#### Scenario: Zoom into a wide diagram
- **WHEN** the user zooms in on a fitted, wide diagram
- **THEN** the diagram is drawn larger and the pane scrolls

### Requirement: Local includes are read from disk
A `!include` (and `!include_once`, `!include_many`, `!includesub`) of a relative or absolute
file path SHALL be resolved against the including file's folder and read from disk, subject to
the same path allowlist as opening a file. An include that cannot be read SHALL show an error
naming it.

#### Scenario: Shared style file
- **WHEN** `docs/arch.puml` contains `!include common/style.iuml` and that file exists
- **THEN** the preview renders the diagram with the included definitions applied

#### Scenario: Missing include
- **WHEN** a diagram includes a file that does not exist
- **THEN** the preview shows an error naming that include

### Requirement: Includes that need the network are reported, not fetched
A diagram that uses `!includeurl`, a URL in `!include`, or a standard-library include (for
example `<C4/C4_Context>`) SHALL NOT trigger a network request; the preview SHALL show the
error that the include could not be loaded.

#### Scenario: Standard-library include
- **WHEN** a diagram contains `!include <C4/C4_Context>`
- **THEN** no network request is made and the preview shows an error naming that include
