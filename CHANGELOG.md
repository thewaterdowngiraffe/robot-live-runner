# Change Log
## [1.0.4] - 2026-09-29

### Changed

- Replaced most popups with a auto disapearing message during the initalization of the live test.
- Increased the time allowed for the debugger to connect to support slower machines.

### Fixed

- Replaced emojis with Unicode numbers so files are utf-8 freindly.
- Ran a small spell check.


## [1.0.3] - 2026-09-24

### Added

- Added "How to use" instructions to the [Readme.md](Readme.md) file.
- Created Change logs.

## [1.0.2] - 2026-09-24

### Fixed

-  Running logic blockers `IF`, `FOR`, `WHILE`, and `TRY` blocks would result in creating a file in your workspace directory. Issue is resolved, files are created using a temp dir that is cleaned up.
- Placing your cursor on a commented out line and running that line would result in the extension trying to run the best fit line above. Bug -> Squashed.
- Trailing indicator, apears on the running line before running instead of after.
