# Spec Delta

## REMOVED Requirements

### Requirement: Cmd+Enter in quick open's path mode opens a folder in the tree
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: Cmd+Enter adds the folder to Recently Opened (Outside).

### Requirement: Quick open advertises browsing outside folders
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: Unchanged, now in `outside-folders`.

### Requirement: A folder row offers Open in Tree
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: the row offers Open in Sidebar.

### Requirement: A folder already covered by a workspace is revealed, not duplicated
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: Unchanged, now in `outside-folders`.

### Requirement: Home and filesystem root are refused
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: Unchanged, now in `outside-folders`.

### Requirement: A temporary folder behaves like a workspace for the session
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: outside folders are listed in Recently Opened (Outside) instead of becoming roots.

### Requirement: Temporary folders are visibly marked
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: outside folders are listed in Recently Opened (Outside) instead of becoming roots.

### Requirement: Temporary folders are not persisted
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: outside folders are listed in Recently Opened (Outside) instead of becoming roots.

### Requirement: Tabs from a temporary folder survive a restart
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: outside folders are listed in Recently Opened (Outside) instead of becoming roots.

### Requirement: Closing and promoting a temporary folder
**Reason**: Outside folders no longer become temporary tree roots; they live in the sidebar's Recently Opened (Outside) section.
**Migration**: `outside-folders`: outside folders are listed in Recently Opened (Outside) instead of becoming roots.
