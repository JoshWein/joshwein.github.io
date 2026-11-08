# Muse

A canvas instrument: height picks one of 16 notes, left to right sets the volume. Keys 1 to 8 switch instruments.

## Multiplayer

Players in the same room (`app.html#roomname`, default `lobby`) see each other's cursors and hear each other's notes. It runs on Firebase Realtime Database with anonymous sign-in, and there's no server to run. Until `firebase-config.js` has a config, Muse is single-player.

To turn it on:

1. In the [Firebase console](https://console.firebase.google.com/), create a project (or reuse one).
2. Build > Authentication > Sign-in method: enable **Anonymous**.
3. Build > Realtime Database: create a database (locked mode is fine).
4. Project settings > Your apps: add a **Web** app and copy its config into `muse/firebase-config.js`.
5. From the repo root, apply the rules: `npx firebase-tools deploy --only database` (`.firebaserc` points at `muse-687b5`).
6. Optional: Authentication > Settings > Authorized domains: make sure `www.joshwein.xyz` is listed.

The rules in `database.rules.json` only let a signed-in player write their own record under `rooms/{room}/players/{uid}`, check every field's type and range, and block everything else. Records are removed when a player disconnects.

### Local testing

Start the emulators (`npx firebase-tools emulators:start --only auth,database --project demo-muse`), serve the repo root, and open `http://localhost:<port>/muse/app.html?emulator#jam` in two windows.
