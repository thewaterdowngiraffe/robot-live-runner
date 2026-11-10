# Robot Framework Live Testing Tool

This is a live testing tool that enables real time interaction with your test cases and resource files.

Struggling with debugging one command and tired of constantly having to relaunch your entire test case to debug and test. This was my issue and why this extension was created. This extension will enable you to run sections of your code as much as you want. Encounter an error: simply fix it and re-run the offending line or block or whatever you want. This tool puts you back in control.


This is a Work in progress and is continuing to improve but there is a few small bugs here and there.


If you find a bug or want to request a feature
---

please visit the [github](https://github.com/thewaterdowngiraffe/robot-live-runner) and open an issue with the bug/feature.

Think you can improve it, feel free to fork and open a request.


# Quality Of Life Features.
-> Smart Selection:
---
- When selecting code from any of the selection methods, it will check if you are on a multi line keyword and navigate up to get the entire thing.
- Logic segments. If you put your cursor on a IF/WHILE/GROUP/FOR/TRY statement, it will grab the entire block and run it so you don't need to select the entire thing.

-> Errors:
---
- When your code errors, it will stop, but not exit allowing you to debug the error in the error state.
- When your code errors, the offending block will be highlighted (the keyword from the queue, does not show you sub keywords).


-> General QOL features:
---
- Shows you what ran.
- highlights what is running.
- The extension does not check your code, it simply formats where needed and passes it into robot framework to run.
- See what was imported
    - Re import Variable files and Resource files.
    - Libraries not supported yet.

# How to run

1. First run recommended:
    1. Navigate to the Robot Live Test Control Tab.
        - Option 1: Run the command `view: Show Robot Live Test` within vscode (ctrl + p to open the command menu).
        - Option 2: Locate and press the Robot Live Test icon on the activity bar.
    2. Launch the Live Test by pressing the <START BUTTON NAME> (Must be on a robot framework Test file. file extension of `.robot`)
2. Standard method:
    1. Open a `.robot` file and press the `Start Live Test` button beside where the normal Play button is. This will open the live test activity bar.
3. You will see a notification saying `Connecting to socket`, please wait for it to say the message `Connected! Live Session Active!`. The same message will also be placed in your terminal once it is ready.
4. Before you start sending commands into the session, please wait for it to say 'test paused.' that will indicate that it is ready to receive commands.


## Activity Bar

You will see 3 sections: Execution Controls, Recent Executions, and Imported Libraries.

### Execution Bar

This will be a quick access location for all of the commands:
- Start Live Test
    > Starts the live test session.

- Run Selected
    > Will run the line your cursor is on / the selected code.

- Run Below
    > runs the current line and everything below until the end of a keyword or test case.
    >> If you have a teardown setup, it will run.


- Run Full Test
    > will search upward from your cursor position to the keyword/testcase name, than run everything below until the end of said keyword/testcase.
    >> Will run teardown and setup commands if they are in the correct location.

- Stop Live Test
    > Will remove your queue, still can not abort your currently executing command.

- Pause Execution
    > will temporarily remove all items from your queue. does NOT pause the currently running keyword. Only visible while running keywords.

- Resume Execution
    > Re-adds your queue. Only visible while paused.

- Stop Current Queue
    > Will clear your run queue.

- Stop Live Test
    > Terminates the Live Test Session. Visible while the session is active. Will immediately exit the session and stop what is currently running.



## Hotkeys:

Run selected: `ctrl+enter` / mac: `cmd+enter`

## Requirements:

Technically: None\*.
> \*The only requirement is that whatever python version or environment you are using the robot framework's library is installed. But to do anything with Robot Framework, you must have it installed so hence the asterisk.





## License

This software is **Dual-Licensed**:

1. **Open Source (GPLv3)**: You can use, modify, and distribute this software for free under the terms of the GNU General Public License v3.0. If you distribute modifications, your project must also be open-sourced under the GPLv3.
2. **Commercial License**: If you wish to use this software in a closed-source, proprietary, or commercial product without the requirements of the GPLv3, you must purchase a commercial license. Please contact me for pricing.