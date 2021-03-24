# WPA BE Admin 

This application serves as an admin tool for controlling various aspects of the WPA BE App and its Firebase backend. The following functions are implemented. This list will be extended and the need arises. 

1. Loading data for *Bible Series*, *Series Content* and *Media*.
2. Verifying users by email. 
3. Creating verified users for development and testing purposes. 

**N.B.** Only a CLI is implemented right now, but it is coded in such a way to easily add a GUI in the future. 


# Getting Started

## Setup WSL2 on Windows

To simplify usage and development, follow [these instructions](https://docs.microsoft.com/en-us/windows/wsl/install-win10#manual-installation-steps) to setup WSL2 on your Windows machine using your choice of available Linux distros (recommended to use at least 18.04). 

## Installing Node 12 using NVM

1. Download the nvm install script via cURL: `curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.0/install.sh | bash`
2. Ensure that nvm was installed correctly with `nvm --version`, which should return the version of nvm installed.
3. Install Node 12 by running `nvm install 12`.
4. Use Node 12 by running `nvm use 12`.

## Setting up the Repository

1. Clone repository.
2. `cd` into `wpa-be-admin`.
3. Ensure that you are using Node 12 by running `node -v`. 
3. Run `npm install`.

## Setting up Access

In order to run this application, you need to have appropriate access to the `wpa-be-app-dev` Firebase Project. Once this is configured, do the following. 

1. Go to Service accounts [settings page](https://console.firebase.google.com/project/wpa-be-app-dev/settings/serviceaccounts/adminsdk) for the `wpa-be-app-dev` project. 
2. Click `Generate new private key`.
3. Rename the downloaded JSON to `service-account-dev.json` and move it to `wpa-be-admin/src/config`.

## Running the CLI on Linux/macOS against local Firebase Emulator

1. `cd` to `wpa-be-admin` on the terminal. 
2. Ensure that the Firebase Emulator is running. See the `README` in the `wpa-be-firebase` repository. 
3. Run `npm run cli`. This defaults the environment to `local_dev` such that the application runs against the local Firebase Emulator. You can also specify the environment by running `WPA_BE_ENV=local_dev bash -c 'npm run cli'`.
4. Navigate CLI options to perform desired operation.

## Running the CLI on Linux/macOS against remote `wpa-be-app-dev` Firebase Project

1. `cd` to `wpa-be-admin` on the terminal. 
2. Run `WPA_BE_ENV=dev bash -c 'npm run cli'`.
3. Navigate CLI options to perform desired operation.
