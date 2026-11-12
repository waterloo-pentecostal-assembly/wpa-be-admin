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

## API access

Every `/api` route on the admin console's server requires a signed-in admin's Firebase ID token
(`Authorization: Bearer <token>`); the UI sends it with every request. The project that issued
the token verifies it, and the user's `users/{uid}` profile there must have `is_admin` set.
Disabled and signed-out (revoked) admins are rejected. The only routes that answer without
signing in are the two the console loads before its sign-in page: `GET /api/firebase-config`
(the public Firebase client config) and `GET /api/env/current` (`prod` or `dev`). A verified
token is trusted for up to a minute, so removing an admin or signing them out everywhere takes
effect within a minute. Request bodies are only read once the caller is known to be an admin.
Publish records' `updated_by` is the verified admin, never a value sent by the browser.

The server doesn't answer other websites (no CORS). If something on another origin must call it,
list the origins, comma-separated, in `CORS_ORIGINS` (e.g.
`CORS_ORIGINS=https://admin.example.org`). The access control is `src/routes/apiAuth.js`,
covered by `npm test` (`test/apiAuth.test.js`), including a check that `server.js` mounts it
before every `/api` route.

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

# User Manager (web UI)

`/users` in the admin console shows each app user as one record: their Firebase Authentication
account and their Firestore `users/{uid}` profile (with `devices` and `notification_settings`),
in the selected environment.

- **Search and filters:** search by name, email, uid or phone (every word must match); filter by
  active, deactivated, unverified, admins, reported, *No profile* (an Auth account with no profile)
  and *No account* (a profile left behind after its account was deleted). The server merges
  `auth.listUsers` with the `users` collection and keeps the result for a minute (**Refresh**
  reloads it). Search, filter, sort, page and the open user are in the URL (`?user=<uid>`).
- **Profile photos:** any profile field named like a photo (`photo`, `image`, `avatar`, `picture`,
  `thumb`) holding a `gs://` or https location is shown as the user's photo, using the thumbnail
  in lists, instead of being listed as text. `gs://` locations are served through signed URLs
  that last an hour. Accounts without one fall back to the Auth `photoURL` (e.g. Google sign-in),
  then to initials.
- **Emails:** **Send reset email** and **Send verification email** have Firebase send its own
  emails (the templates in the Firebase console, the same ones the app sends) through the Identity
  Toolkit REST API. This needs the environment's **web API key**, which isn't in the service
  account file. The server uses `FIREBASE_WEB_API_KEY` (prod) or `FIREBASE_WEB_API_KEY_DEV` (dev)
  if set. Otherwise it uses the Firebase client config's `apiKey` when that config is for the same
  project. Without a key, the send buttons are disabled and say what to set. A verification email
  has to be requested as the user, so the server briefly signs in as them with a custom token, and
  that updates their *last sign-in* time.
- **Actions:** password reset and email verification links (generated by Firebase but not sent;
  copy one or open a prefilled email; the link buttons sit next to the send buttons), approve / revoke approval (profile
  `is_verified`, which means an admin accepted the user), mark email verified / unverified (Auth
  `emailVerified`, which means the user clicked the link in their verification email; the two are
  shown and filtered separately), sign out everywhere (revokes refresh tokens), deactivate/reactivate (disables
  the Auth account; deactivating also signs the user out), grant/remove admin (`is_admin`), edit
  name and email (an email change updates both records and marks the email unverified, but keeps
  approval), clear
  reports, create a missing profile, create a user, and delete. Deleting removes the Auth account
  and the profile with its subcollections. The user's completions, prayer requests and
  testimonies are kept unless you tick *Also delete all of their data*, which deletes them (with
  any subcollections) and any profile photo kept in Firebase Storage. You have to type the user's
  email to confirm.
- **Admin notifications:** granting admin subscribes the user's device tokens to the admin FCM
  topics (`user_signup_notifications`, `user_delete_request`, `new_testimony_for_approval`,
  `new_prayer_request_for_approval`). Removing admin, deactivating or deleting an admin
  unsubscribes them, and reactivating an admin subscribes them again.
- **Access:** like every `/api` route (see *API access*), `/api/users` requires the signed-in
  admin's Firebase ID token. The project that issued the token verifies it (the console signs in
  to one project but can manage either), and the server checks `is_admin` there. Disabled or
  signed-out admins are rejected. Admins can't deactivate, delete or remove admin access from their own account.
  Every change is logged on the server with the acting admin's email.

The service is `src/services/userAdminService.js` and the routes are `src/routes/userRoutes.js`.
Both are covered by `npm test`.

# Notification Hub (web UI)

`/notifications` in the admin console sends ad hoc push notifications (FCM) in the selected
environment. It replaces the old single-token Notification Tester.

- **Audiences:**
  - *Device tokens*: paste FCM tokens, one per line. Tokens that belong to a registered device are
    matched to their user in the preview.
  - *Specific users*: search and add users. Each one gets *All devices* or only the *Selected*
    devices you tick.
  - *Behind on series*: users whose completion percentage is below the expected percentage
    (optionally by more than N percentage points). By default only days before today are expected
    (tick *Count today as due* to include today). Users who haven't started at all are left out
    unless you include them.
  - *Ahead on series*: users whose completion percentage is above the percentage of days up to
    and including today (optionally by more than N percentage points). Users who have finished
    the series are left out; they're in *Completed series*.
  - *Haven't started*: users with no completions in the active series.
  - *Completed series*: users who have completed every day of the active series.
  - *Signed up recently*: users whose sign-in account was created in the last N days (7 by
    default).
  - *All users* and *Admins*.

  Progress is measured by day. The active series' `series_content_snippet` gives each day's
  engagements (dates in the America/Toronto time zone). A day counts as complete when the user has
  completed at least one of that day's engagements. A user's progress is their complete days as a
  percentage of the series' days, compared with the percentage of days due. The percentage is read
  as is from the user's `achievements` document (`series_progress`, kept up to date by a Cloud
  Function on each completion and reset at the start of each series), one read per user. Behind
  and ahead are the gap between it and the expected percentage, in percentage points. A
  user who has done today's day but missed an earlier one is therefore on track. Today never
  makes anyone ahead. Group
  audiences skip deactivated users and profiles without a sign-in account by default, and can
  skip users who turned off `daily_engagement_reminder` (on by default for the progress groups).
- **Placeholders:** the title and message can include `{first_name}`, `{last_name}`,
  `{full_name}`, `{series_title}`, `{total_days}`, `{percent}`, `{expected_percent}`,
  `{percent_behind}`, `{percent_ahead}` and `{percent_left}`. They're listed under
  *Personalize with placeholders*; clicking one inserts it at the cursor. Each recipient gets
  their own values, worked out the same way as the progress groups, for any audience while a
  series is active. `{key|fallback}` gives a fallback for anyone without a value (e.g.
  `{first_name|friend}`). An empty value with no fallback is dropped, with the space before it.
  Unknown placeholders are rejected before sending. The phone preview can show the message as
  any previewed recipient (*Preview as*), and the history keeps the message as written, with its
  placeholders. The placeholder code is `ui/src/notifications/placeholders.js`, which the server
  also uses.
- **Preview:** shows how many users and devices an audience reaches, who they are (with progress
  while a series is active), and who was skipped and why. Choosing another group clears it. A
  token shared by two accounts is only sent once. Clicking **Review & send** previews again, then asks you to confirm. If the send reaches 10
  or more devices, you type the device count to confirm.
- **Test on my devices** sends the message only to the devices of the admin account you're signed
  in with. **Dry run** has FCM validate every message and token without delivering anything.
- **Dead tokens:** when FCM reports a token as no longer registered (the app was uninstalled or the
  token expired), the hub can remove that device document. This is on by default in the
  confirmation and never happens on a dry run.
- **History:** every real send is recorded in the environment's `admin_notification_log`
  collection, with who sent it, the message, the audience (tokens masked) and the delivery counts.
  **Reuse** copies a past message (and a group audience) back into the form, and the trash button
  deletes a send from the history after you confirm. Deleting only removes the record; the
  notifications were already delivered. The server logs who deleted it. The list scrolls within the
  panel instead of growing the page.
- **Opening the series in the app:** under *Data payload*, **Open the current Bible series** sets
  `notificationType` to `dailyEngagementReminder` and `bibleSeriesId` to the active series' ID.
  Those are the values the app's notification tap handler (wpa-be-app,
  `lib/services/firebase_messaging_service.dart`) uses to open a series on the Engage tab. The
  section then says which series a tap opens. If a template or reused send has the ID of a
  different series, it says so and offers to switch to the current one. The app logs these taps
  in Analytics as `daily_engagement_notification_clicked`, the same as its daily reminder.
- **Templates:** save messages you send often. A template holds a name, the title, the message
  (placeholders and all) and the data payload. It can also hold a group audience (e.g. *Behind on
  series* by more than 5 points); lists of users or tokens aren't saved, because they go out of date.
  The template dropdown at the top of the message shows the loaded template. Its menu lists each
  template with its title and saved group (with a search box once there are several), and has
  **Save as template** and **Manage** (rename or delete). Picking a template fills in the form (and
  selects its group), with **Undo** in case it replaced something. The bookmark button beside the
  dropdown also saves a new template. After you edit a loaded template, a bar offers **Update**
  (which can also rename it) or **Save as new**. Names are unique (ignoring case), and placeholders
  are checked when a template is saved. Templates are kept per environment in the
  `admin_notification_templates` collection, with who created and last updated each one.
- **Access:** like every `/api` route (see *API access*), `/api/notifications` requires a signed-in
  admin's Firebase ID token.
- **Restarting the server:** `npm run server` doesn't reload when the code changes. Use `npm run
  start:dev` (or `npm run server:watch`), which restarts the server whenever its code changes. If
  the page says the server doesn't know a group, the server is older than the page; restart it.

The service is `src/services/notificationHubService.js` and the routes are
`src/routes/notificationRoutes.js`. Both are covered by `npm test`.
