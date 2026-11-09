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

# Series Builder (web UI)

`/bible-series` in the admin console builds a Bible series and publishes it in the
`{ bible_series, series_content }` format the app reads.

- **Workflow:** pick the dates (weekdays, Mon/Wed/Fri, Tue/Thu, custom, or specific dates), pick the
  engagements for each weekday (e.g. Devotional on Mondays only), then set each day's scripture (typeahead, paste a whole reading
  plan, or Ctrl+Enter to save and move to the next day). Engagement content comes from per-series
  **templates**; `{scripture}` in template text becomes each day's reference, and template blocks
  marked *per day* (prayer points, song link, memory verse) are filled in on each day. **Copy to…**
  copies an engagement or a day's scripture to all days, every Monday, the rest of the week, etc.
- **Autosave:** drafts are saved to the `admin_series_drafts` Firestore collection of the selected
  environment (prod drafts in the prod project, dev drafts in the dev project) and mirrored in the
  browser. The env switcher changes which drafts are listed; **Copy to prod/dev** on a draft card
  puts a copy in the other environment (copying the same draft again offers to replace that copy).
  Without any Firebase credentials, drafts are kept in the browser only.
- **URL:** the environment, open draft and selected day are in the URL
  (`?env=dev&draft=…&view=day:…`). A link for the other environment asks before switching, since
  the server's environment applies to every open tab.
- **Cover images** upload to the selected environment's bucket (`<project_id>.appspot.com`, or
  `FIREBASE_STORAGE_BUCKET` / `FIREBASE_STORAGE_BUCKET_DEV`) under `bible_series/<series-slug>/`.
- **Publishing** fills in NIV verse text, checks for problems, and publishes to the selected
  environment on the server (`POST /api/drafts/:id/publish`). A draft is linked to at most one
  series: its `series_id` is set on the draft document as soon as the `bible_series` document
  exists, then the content is written in the background, so closing the browser mid-publish loses
  nothing. Each publish, update and open is recorded in the draft's `publishes` field (`kind`,
  status, progress, failed entries, `updated_by`: the signed-in admin's user ID). History is shown in
  Series details; the library shows each draft as *Published* or *Draft*. Drafts saved before
  `series_id` existed get it from their older publish records. Draft documents use snake_case keys
  like the rest of the database; documents written with the earlier camelCase keys are still read,
  are rewritten whenever they are saved, and are migrated in the background when the server
  starts.
- **Series snippet:** every write path (publish, update, `/api/series/upload`, the CLI) sets the
  `bible_series` document's `series_content_snippet`, `start_date` and `end_date` itself, in the
  draft's day/engagement order (`src/services/publishedSeries.js`). The `updateBibleSeriesSnippet`
  Cloud Functions in wpa-be-firebase are no longer needed and must be undeployed: if they keep
  running, they append duplicate snippet entries for content written here.
- **Updating a published series:** a draft linked to a series (published from it, or opened from
  it) shows **Update** instead of Publish, and only publishes again if that series was deleted. The server compares the compiled draft with the series'
  `series_content` and previews the changes (series details, changed/added/removed entries, and
  user completions on removed entries) as a diff of each entry's text; applying writes only those
  changes and rebuilds the snippet. Only edits made in the draft count: the server also opens the
  stored series and compiles it again (`src/services/seriesBaseline.js`), and differences that
  opening alone produces (blank scripture titles, another NIV edition's verse text, trailing
  spaces in older series) are ignored. Within a changed entry, blocks the draft didn't touch keep
  their stored form. Entries are edited in place, matched by date and type (and leftovers of the same type in
  date order, so a moved entry keeps its ID), so `completions` that reference them keep counting.
  Updates are recorded in the draft's `publishes` with `kind: 'update'`.
- **Open published:** any series in the selected environment (including ones loaded with the CLI or
  edited in the console) can be opened as a new draft linked to it, then corrected and updated. A
  series has at most one draft; opening it again opens that draft.
- Existing series JSON files can be imported as drafts; repeated content becomes templates.

The pure logic (schedule, templates, compiling to JSON, import) lives in `ui/src/series/` and is
covered by `npm test`.
