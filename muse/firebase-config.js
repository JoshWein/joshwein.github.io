// Firebase web config for Muse multiplayer. These values are public by
// design; database.rules.json is what keeps the database safe.
//
// To turn multiplayer on: Firebase console > Project settings > Your apps >
// Web app > SDK setup and configuration > Config, then paste it here, e.g.
//
// export const firebaseConfig = {
//   apiKey: "...",
//   authDomain: "your-project.firebaseapp.com",
//   databaseURL: "https://your-project-default-rtdb.firebaseio.com",
//   projectId: "your-project",
//   appId: "...",
// };
//
// While this is null, Muse runs single-player.
export const firebaseConfig = null;
