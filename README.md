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
2. Run `npm run cli:dev` (or `WPA_BE_ENV=dev bash -c 'npm run cli'`). `npm run cli:prod` runs against prod.
3. Navigate CLI options to perform desired operation.

## CLI menu

Pick with the arrow keys and Enter; every submenu has **← Back**, and the main menu has **Exit**. A failed
operation prints its error and returns to the menu. Operations marked `[writes]`/`[deletes]` ask before
changing anything, and in prod you have to type `prod`.

- **Users:** verify a user by email; count users who signed up on or after a date; count active users
  between two dates; subscribe all admins' devices to the admin notification topics; reset every user's
  notification settings to all on `[writes]`; clean up invalid device tokens `[deletes]`.
- **Load data:** load a media or Bible series JSON file from `src/data`.
- **Fetch data:** progress data (CSV); completions by engagement type for a series; unique users in a
  series; completions per day for one engagement type (table, optional CSV). Series are picked from a
  list, newest first. CSVs go to `src/data/progress_records/`.
- **Scripture:** backfill dry run / apply (all series or chosen ones; see *Backfilling existing series*),
  restore a backfill backup (picked from `backups/`), check Bible proxy access, and sign out of the
  proxy. Fetching scripture is the only thing that needs you to sign in (see *Bible proxy sign-in*);
  everything else in the CLI uses the service account.
- **Maintenance:** convert YouTube links in all series to embed URLs (shows a dry run first, then
  `[writes]`); delete prayer requests dated before a date, with any subcollections (shows the count, then
  `[deletes]`); fill empty Psalms verses in a
  local series file from `src/data/psalms.json`.
  Also: shorten forum thread titles over 150 characters (dry run first, then `[writes]`; see *Fixing long
  thread titles*) and restore such a fix from its backup.
- **Development assist (dev only):** create a verified test user.

`npm run backfill:scripture` and `npm run check:bible-proxy` still work for scripting; they run the same
code as the Scripture menu (`src/cli/scriptureTasks.js`).

### Bible proxy sign-in

The Bible proxy only accepts an admin's Firebase ID token, so the backfill and the proxy check sign you in
(Firestore itself is reached with the service account, as everywhere else in the CLI). You sign in to
`wpa-be-app`, the project the proxy accepts, whichever `--env`/`WPA_BE_ENV` you work on
(`BIBLE_PROXY_AUTH_ENV=dev` uses `wpa-be-app-dev` instead).

The first time, you're asked for your email and password. The session's refresh token is then saved,
like `firebase login` does, to `~/.config/wpa-be-admin/admin-session-<project>.json` (readable only by
you, outside the repo), and later runs use it without asking. You're asked again only after you sign out
(**Scripture → Sign out of the Bible proxy**, or delete that file), change your password, or the token is
revoked (`auth.revokeRefreshTokens(uid)`). Set `BIBLE_ADMIN_REMEMBER=0` to never save it.

### Fixing long thread titles

Threads created before the app limited title length can have titles too long to lay out. The fix
(`src/services/threadTitleFix.js`) finds threads at `forums/{seriesId}/threads/{threadId}` whose `title` is
over 150 characters (UTF-16 code units, like Dart's `String.length`) and, for each, in one batch:

- cuts `title` to at most 150 characters ending in `...` (never splitting an emoji or accented letter);
- adds the full original title as a comment by the thread's author, with the thread's `created_at` (so it
  is the first comment) and the same fields as other comments (`liked_by` empty, of the type the forum's
  comments use);
- increments `comment_count`. `updated_at` is left alone.

```sh
npm run fix:thread-titles -- --env prod                       # dry run: lists the threads
npm run fix:thread-titles -- --env prod --series <id> --apply # one series' forum
npm run fix:thread-titles -- --env prod --apply               # every forum (asks first)
npm run fix:thread-titles -- --env prod --restore backups/thread-titles-prod-<time>.json
```

`--apply` first saves the original titles and the new comments' IDs to `backups/`; `--restore` puts the
titles back and deletes those comments (skipping threads whose title changed since). Also in the CLI:
**Maintenance**. The comments are new documents, so anything that runs when a comment is created (such
as a Cloud Function sending notifications) runs for them too.

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
- **Publishing** fills in verse text from API.Bible (through the Bible proxy) in the series' translation (see *Scripture* below), checks for problems, and publishes to the selected
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
  spaces in older series) are ignored. Changing the series' translation counts as an edit to every
  scripture block. Within a changed entry, blocks the draft didn't touch keep
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
  if set. Otherwise it uses the `apiKey` in that environment's Firebase client config
  (`src/config/firebase-client-config.json` for prod, `firebase-client-config-dev.json` for dev, or the
  `FIREBASE_CLIENT_CONFIG` / `FIREBASE_CLIENT_CONFIG_DEV` env var) when that config is for the same
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

# Maintenance (web UI)

`/maintenance` in the admin console cleans up old data in the selected environment. For now it deletes
**prayer requests** and **testimonies** dated before a day you pick (start of that day, Toronto time),
together with anything stored under them (subcollections). Entries without a `date` are never deleted.

- Choosing the day shows, for each kind, how many are older and how many there are in all. Untick a kind
  to keep it.
- **Delete** asks first; in prod you have to type `prod`. The request names the environment the counts
  were for, and the server refuses (409) if it has switched since. Dates after tomorrow are refused.
- Each delete is logged on the server (`[maintenance] <admin> deleted <n> <kind> dated before <day> (<env>)`).
- API (admins only): `GET /api/maintenance/old-content?before=YYYY-MM-DD` and
  `POST /api/maintenance/old-content/delete` `{ before, kinds: ['prayer_requests', 'testimonies'], env }`
  (`src/routes/maintenanceRoutes.js`, `src/services/dataDeletingService.js`).

# Scripture (Bible proxy)

Scripture text comes from [API.Bible](https://docs.api.bible), not the bundled `niv.json`, so each series
can use a translation the account is licensed for. The console never calls API.Bible itself and holds
no API.Bible credentials: everything goes through our Bible proxy, **wpa-be-bible-proxy**
(`https://wpa-be-bible-proxy.onrender.com`). The proxy holds the API.Bible keys, caches responses and
handles API.Bible's terms (the 29-day cache limit and content purges). Its `/admin/v1` paths and
response bodies are API.Bible's (`/bibles`, `/bibles/{id}/chapters/{chapterId}`, …, including
`meta.fumsToken`).

## How requests are authenticated

The proxy only serves signed-in admins (`is_admin: true` in Firestore `users/{uid}`, the same rule as
the console) and has no service-to-service auth. The browser calls this server's `/api/bible/...`
routes with the admin's Firebase ID token like every other API call; the server then calls the proxy
with **that same token** (`Authorization: Bearer <token>`), never with a key or service account
(`src/services/apiBibleClient.js`, `withAuth`). The CLI scripts sign in as an admin with email and
password instead (`src/services/adminSession.js`).

The proxy accepts tokens from the Firebase projects it has service accounts for. If the console signs
admins in to a project the proxy doesn't know (e.g. dev), scripture requests get 401.

Proxy errors (`{ statusCode, error, message }`) reach the console like this:

| Proxy | Server | Browser |
|---|---|---|
| 400 (parameter not allowlisted, bad ID) | 400, logged as a bug | shows the message |
| 401 (token missing, expired, revoked) | 401 (scripts refresh their token and retry once) | refreshes the token (`getIdToken(true)`) and retries once; if that fails too, signs out to the sign-in page |
| 403 (not an admin) | 403 | shows the message |
| 429 (rate limit; shouldn't happen now that `/admin` isn't rate-limited) | pauses every request for the Retry-After (up to 20 s) and retries; longer ones are returned as 429 with `Retry-After`. The log says whether the proxy or Cloudflare/Render sent it | waits out a short Retry-After once, otherwise "try again in N seconds" |
| 502 / 503 (API.Bible down, nothing cached) | retried only if Retry-After is short; then 503 "try again later" with `Retry-After` | shows "try again later" |

Only query parameters the proxy allowlists are sent: `content-type` and `include-*` on chapters (and
`content-type` on passages), `include-chapters` on books. Anything else is a 400.
`GET https://wpa-be-bible-proxy.onrender.com/admin/routes` (admin token required) lists every route
with its allowed parameters; `npm run check:bible-proxy -- --routes` prints it.

## Configuration

Environment variables (Render: *Environment*). None of them is a secret. Locally you can put them in a
git-ignored `.env` file at the repo root (`NAME=value` per line); the server and scripts load it at startup
(`src/config/loadEnv.js`), and variables already set in the shell take precedence.

| Variable | |
|---|---|
| `BIBLE_API_BASE_URL` | The proxy's API.Bible base URL. Default `https://wpa-be-bible-proxy.onrender.com/admin/v1`. |
| `API_BIBLE_DEFAULT_BIBLE_ID` | Translation used by series that don't pick one, and by the backfill. |
| `API_BIBLE_BIBLE_IDS` | Comma-separated translations admins may pick. Empty = every Bible the proxy serves. List only translations the licence covers. The first one is the default if `API_BIBLE_DEFAULT_BIBLE_ID` isn't set. |
| `BIBLE_API_RATE_LIMIT` | Optional cap on requests this server sends the proxy, e.g. `5/s` or `60/min`; requests over it wait their turn. Unset (the default) = no pacing; the proxy's `/admin` routes aren't rate-limited. |
| `API_BIBLE_FUMS` | `false` stops reporting [FUMS](https://docs.api.bible/resources/fair-use) views (reported once per chapter fetched, from the `meta.fumsToken` the proxy passes through). |

Because the browser only talks to this server, the proxy doesn't need this console's origin in its
`CORS_ORIGINS`.

Opening a draft in the series builder looks up every passage it uses (one request per chapter, from
this server's copy or the proxy's cache when it has been fetched before), so previews and checks are
ready straight away.

The proxy is the cache. This server also keeps a copy (chapter text, translation details and book
lists for 6 hours; a purge from the Scripture Proxy page clears it), fetches whole chapters (one request each, shared by
every reference in that chapter), and refuses references over 40 chapters. Chapter and verse counts for
the typeahead come from `src/data/verse_counts.json` and cost no requests.

## Checking the setup

```sh
npm run check:bible-proxy                         # sign in as an admin of wpa-be-app (asks for the password)
npm run check:bible-proxy -- --bible <id> --non-admin someone@example.org --routes
```

It checks that a request without a token gets 401 (and, with `--non-admin`, that a non-admin gets 403);
then, as the admin, `/admin/whoami`, the translations, and each request the console makes (a 400 here
means a parameter isn't allowlisted). It also checks that repeating a request comes from the proxy's
cache (`X-Cache: MISS`, then `HIT`), and prints `/admin/stats`. The email can also come from `--email` or
`BIBLE_ADMIN_EMAIL`. You sign in to the project whose admins the proxy accepts: `wpa-be-app`, or
`wpa-be-app-dev` with `BIBLE_PROXY_AUTH_ENV=dev` (once the proxy accepts dev tokens). Sign-in uses that project's web API key (`FIREBASE_WEB_API_KEY` /
`FIREBASE_WEB_API_KEY_DEV`, or the `apiKey` in `firebase-client-config.json` /
`firebase-client-config-dev.json`).

## Scripture Proxy page

`/scripture-proxy` in the console shows the proxy's `/admin/stats` (cache hit rate, upstream calls, masked
key status) and `/admin/whoami`, and purges its cache (`{"all":true}`, `{"bibleId":"…"}` or
`{"audioBibleId":"…"}`, after a confirmation). The server forwards these calls with your token
(`/api/bible-proxy/stats`, `/whoami`, `/routes`, `POST /cache/purge`); a purge also clears this server's
short-lived copy.

## Translation per series

**Series details → Bible translation** sets the draft's `meta.bible_id` (blank = the default). The
builder resolves references through `/api/bible/:bibleId/...` (`default` for the default):
`/translations`, `/aliases`, `/:bibleId/books`, `/:bibleId/books/:book/chapters`,
`/:bibleId/books/:book/chapters/:chapter/verses`, `/:bibleId/passage?ref=` and
`POST /:bibleId/passages`. The old `/api/bible/niv/*` and `/api/niv` endpoints are gone.

## Stored format

Scripture blocks keep everything existing app versions read, with `scriptures` in exactly its old shape.
Next to it, at the root of the block, `passage_ids` lists the API.Bible passage IDs of the whole block in
order: what an updated app fetches instead of reading `verses` (`ui/src/series/scriptureRefs.js`). There
is one ID per run of consecutive verses, so a chapter with gaps contributes several:

```json
{
  "body_type": "scripture",
  "attribution": "<translation copyright from API.Bible>",
  "bible_version": "Scripture quotations taken from Berean Standard Bible (BSB)",
  "passage_ids": ["ROM.4.1-ROM.4.3", "ROM.4.5-ROM.4.5", "ROM.5.1-ROM.5.2"],
  "scriptures": [
    { "book": "Romans", "chapter": "4", "title": "Romans 4:1-3, 5; 5:1-2",
      "verses": { "1": "...", "2": "...", "3": "...", "5": "..." } },
    { "book": "Romans", "chapter": "5", "title": "", "verses": { "1": "...", "2": "..." } }
  ]
}
```

Passage IDs don't depend on the translation: the app chooses one (app default or the user's setting) and
fetches `/bibles/{bible ID}/passages/{passage_id}` through the Bible proxy, never from API.Bible with a
key shipped in the app. If the app has web functionality, it should also report the response's
`meta.fumsToken`. Blocks without `passage_ids` are older content; fall back to `scriptures[].verses`.

The `bible_series` document's `scripture_bible_id` records which translation the stored text is in. It is
admin-only: the series builder uses it when a published series is opened, and the backfill uses it.
Apps shouldn't use it.

## Backfilling existing series

`scripts/backfill-scripture.js` rewrites scripture already in Firebase: verse text, `attribution` and
`bible_version` in the chosen translation, plus the block's `passage_ids` (IDs an earlier run put on each
`scriptures` entry are moved there: a series recorded in the translation is still redone while any of its
blocks is in that old layout, without needing `--force`). Book names, chapters,
verse numbers and titles stay as they are. Content entries only have `body` written, so content IDs,
completions and snippets are untouched. Once every scripture block in a series is converted, the
series' `scripture_bible_id` is set. Verses the translation lacks (e.g. Matthew 17:21 in many modern
translations) are dropped and reported. Blocks whose book or chapter it lacks are left unchanged and
reported.

```sh
npm run backfill:scripture -- --env dev                          # dry run: report only
npm run backfill:scripture -- --env dev --series <id> --apply    # one series
npm run backfill:scripture -- --env prod --apply                 # everything (asks before writing to prod)
npm run backfill:scripture -- --env prod --restore backups/scripture-prod-<time>.json
```

- Dry run by default. `--apply` first saves the current bodies and series translations to `backups/` (git-ignored, because it
  contains scripture text); `--restore` puts them back.
- It fetches scripture through the Bible proxy, so it first asks you to sign in as an admin (email from
  `--email` or `BIBLE_ADMIN_EMAIL`; only the first time, see *Bible proxy sign-in*). That's an admin of `wpa-be-app`, the project the proxy accepts, even
  with `--env dev` or `local_dev`: the sign-in only decides who may fetch scripture, and the writes use
  `--env`'s service account. `BIBLE_PROXY_AUTH_ENV=dev` signs in to `wpa-be-app-dev` instead. `--restore` doesn't.
- `--bible <id>` picks the translation (default: `API_BIBLE_DEFAULT_BIBLE_ID`). Series already recorded
  in it are skipped without any proxy requests, unless `--force`. Series with blocks that couldn't be
  converted aren't recorded, so they are checked again on the next run.
- Before fetching anything, it counts the distinct chapters involved. It stops if that's over
  `--max-calls` (default 1000).
- Backfill with the translation the series' drafts use (normally the default). If a linked draft uses
  a different one, its next **Update** will rewrite the scripture into the draft's translation.

