# Getting started

## Where to start

The flow for adding to the repo is to create a pull request to add your fork into the `pre-release` branch. Once/if approved, it will move into the main branch. After a successful merge into `pre-release`, the extension will be compiled and uploaded to VScode's extension market place with the pre-release flag.

## Setup

First install all of the requirements for the extension and the python portion of the script.


```shell
npm install
pip install -r python/requirements.txt
```
> This has not been tested on linux or OS X based systems yet.



### First Run

> Note: When debugging or running the extension from this repo, a fresh vscode profile will be created called `ext_dev_RFLT`. VScode is unable to create this profile on first run and install the extensions at the same time. When you press `F5` on your first run, press the `debug anyway` message to create the profile. Then once it finishes loading please press the restart debugger button. After the restart, the required extensions will be installed and first run setup is now finished.

