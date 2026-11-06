# Change Log

## [1.1.0] - 2026-11-06

### Changed
- Moved most of the buttons to a dedicated side panel.
- Rewrote most of the extension.

### Added

- You can now see up to the last 20 ran lines and click on them to jump to the file and section (locations are fixed, modifying the file may result in jumping to the incorrect lines).
- Added quick re-import for variable files and resource files.
- Added QOL features for when errors occur.
- When executing a keyword that has [Startup] or [Teardown] in it the extension will assume that they are in the correct location and will simply drop the [setup] or [teardown] prefix before running. You will be informed of the assumption via a toast notification.


### Fixed

- keywords that return more than one variable are now able to be cast the data back correctly.


## [1.0.6] - 2026-10-06

### Changed

- Noticed potential issue with VAR mapping where if you had a custom keyword that started with `VAR ` it would try to map it. example `VAR Zip list` that would trigger the var mapping. now logic checks for a minimum of 2 spaces after `VAR`.

### Added

- Started the prep work for exposing functions to enable unit tests for the `live_listener` file.
- Added a TODO.md file, using [todo.md](https://github.com/todomd/todo.md) as a standard* (subject to change).

### Fixed

- Found the cause of the "Illegal value for `line`", drawing the line of what has ran, could be out of bounds of the file resulting in the above message. this has been resolved by applying a filter to the lines to ensure they are in bounds

## [1.0.5] - 2026-10-05

### Fixed

- Calling `VAR    ${Hello}    World` would soft crash the live test as `VAR` was not handled correctly, now if you directly call the `VAR` it will be mapped to a legacy keyword and honor your defined scope.
- Improved VAR function handling by dropping the comments before splitting.

## [1.0.4] - 2026-09-29

### Changed

- Replaced most popups with a auto disappearing message during the initialization of the live test.
- Increased the time allowed for the debugger to connect to support slower machines.

### Fixed

- Replaced emojis with Unicode numbers so files are utf-8 friendly.
- Ran a small spell check.


## [1.0.3] - 2026-09-24

### Added

- Added "How to use" instructions to the [Readme.md](Readme.md) file.
- Created Change logs.

## [1.0.2] - 2026-09-24

### Fixed

-  Running logic blockers `IF`, `FOR`, `WHILE`, and `TRY` blocks would result in creating a file in your workspace directory. Issue is resolved, files are created using a temp dir that is cleaned up.
- Placing your cursor on a commented out line and running that line would result in the extension trying to run the best fit line above. Bug -> Squashed.
- Trailing indicator, appears on the running line before running instead of after.
