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


# How to Use
1. Open a robot framework `.robot` file
2. Locate and press the start `start live session` near the play button ![](https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/play-circle.svg)
3. Once pressed you will run the suite setup (if applicable) than it will wait for you to select code to run.
4. Running code. There are several ways to run your robot framework code with this tool.
    1. Selecting code. Once selected you may run it by pressing the `run selected` button ![](https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/list-selection.svg) or press `Control` + `Enter` on your keyboard. To select the code to run here are the two main ways of doing it.
        1. Place your cursor on a line to indicate that you want to run just that line.
        2. Highlight rows to run all selected rows (if you select part of a row, the entire row will be selected)
    2. Run bellow: Place your cursor on a line with robot framework code then press the `Run bellow` button ![](https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/arrow-down.svg). This will run all code bellow where your cursor is.
    3. Run full test ![](https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/run-all.svg) Pressing the `Run full test` button will locate the current test case your cursor is in and run it from the begining.
5. Other commands. While the steps are running, you will see a button to pause execution, resume execution, and end queue.
    1. Pause: Will wait for whatever is running to stop, but will not run anything else untill you press resume.
    2. Resume: only visible while paused, but will resume the execution of your queue.
    3. Exit queue: This will end your *queue* so you may edit or rerun segments of your code. If keywords are activly running, whatever keyword is activly running will need to finish before the queue is cleared.
6. Exiting Live test mode. Locate the `Stop Live Session` button ![](https://raw.githubusercontent.com/microsoft/vscode-codicons/main/src/icons/trash.svg) this will simply quit the active test/queue in full.

## QOL Features
- Indicator for what is activly running
- Indicators for last few keywords ran. (you may adjust the colour and length of the indicator)
- If you edit the vscode settings for the robotcode plugin several settings will be honored.
    - output dir
    - variables
- I have made attemps to have this solution attempt to adhear to the any settings set within the `launch.json` file.
    > I can not promise that it will work every time. This feature was added because I needed to have a second listener. Your milage may vary currently it only keeps the `'args'` from the launch config.
- Code will try to use whatever python environment you have selected.
    > Note this will not work if you do not have `robotframework` installed within that env. run the bellow command to install it.
    ```cmd
    python -m pip install robotframework
    ```
- There are several small adjustments that can be made within the vscode settings for this extension.


## License

This software is **Dual-Licensed**:

1. **Open Source (GPLv3)**: You can use, modify, and distribute this software for free under the terms of the GNU General Public License v3.0. If you distribute modifications, your project must also be open-sourced under the GPLv3.
2. **Commercial License**: If you wish to use this software in a closed-source, proprietary, or commercial product without the requirements of the GPLv3, you must purchase a commercial license. Please contact me for pricing.