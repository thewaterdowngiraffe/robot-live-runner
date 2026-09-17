# Robot Framework Live Testing Tool

A Visual Studio Code extension that enables real-time, interactive test execution for Robot Framework.

Instead of waiting for an entire test suite to run, this tool pauses execution and allows you to send specific keywords, variables, or multi-line control blocks (like `FOR` and `IF` loops) directly from your editor to the active Robot Framework session.

## Features
* **Interactive Execution:** Highlight code or place your cursor on a line to run individual lines or blocks on the fly.
* **Smart Control Block Parsing:** Natively handles `FOR`, `WHILE`, `TRY`, and `IF` statements (both block and inline) without crashing the live session.
* **Terminal Output:** Routes all execution logs directly to the VS Code terminal.

## Installation
1. Go to the [Releases page](../../releases) of this repository.
2. Download the latest `.vsix` file.
3. Open VS Code and navigate to the **Extensions** view (`Ctrl+Shift+X`).
4. Click the `...` menu at the top right of the Extensions panel.
5. Select **Install from VSIX...** and choose the downloaded file.

## License

This software is **Dual-Licensed**:

1. **Open Source (GPLv3)**: You can use, modify, and distribute this software for free under the terms of the GNU General Public License v3.0. If you distribute modifications, your project must also be open-sourced under the GPLv3.
2. **Commercial License**: If you wish to use this software in a closed-source, proprietary, or commercial product without the requirements of the GPLv3, you must purchase a commercial license. Please contact me for pricing.