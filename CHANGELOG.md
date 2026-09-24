# Change Log
## [1.0.3] - 2026-09-24

### Added

- How to use instructions to the Readme.md
- Created Change logs

## [1.0.2] - 2026-09-24

### Fixed

-  Running logic blockes `IF`, `FOR`, `WHILE`, and `TRY` blocks would result in creating a file in your workspace directory. Issue is resolved, files are created using a temp dir that is cleaned up.
- placing your cursor on a commented out line and running that line would result in the extension trying to run the best fit line above. Bug -> Squashed.
- Trailing indicator, apears on the running line before running instead of after.
