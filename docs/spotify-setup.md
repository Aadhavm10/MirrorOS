# Spotify Setup

Voice control of Spotify playback ("hey Jarvis, play …"). Requires **Spotify
Premium** — the Web API only allows playback control on Premium accounts.

Playback happens on your **active Spotify Connect device** (phone, computer,
speaker). The mirror sends commands; it doesn't produce the audio itself.
(Running librespot on the mirror to make it a speaker is a future addition.)

## 1. Create a Spotify app (~2 minutes)

1. Go to https://developer.spotify.com/dashboard and log in with your normal
   Spotify account.
2. **Create app**:
   - Name: `MirrorOS`, description: anything
   - **Redirect URI**: `http://127.0.0.1:3000/spotify/callback`
     (must match exactly — note `127.0.0.1`, not `localhost`)
   - Check **Web API** → Save
3. Open the app → **Settings** → copy the **Client ID** and **Client secret**.

## 2. Configure MirrorOS

In `.env`:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Restart the server.

## 3. Connect your account (once)

Open **http://127.0.0.1:3000/spotify/login** in a browser on the same machine,
approve the permissions, and you'll see "Spotify connected ✓". Tokens persist
in `server/spotify-tokens.json` (gitignored) and refresh automatically —
you won't need to log in again.

## 4. Use it

Open Spotify on any device (so a Connect device exists), then:

- "Hey Jarvis… play Bohemian Rhapsody"
- "Hey Jarvis… play the Discover Weekly playlist"
- "Hey Jarvis… pause" / "next song" / "set the volume to forty"
- "Hey Jarvis… what's playing?"

## Notes

- Free-tier Spotify accounts get an error from the playback API — Premium only.
- "No device available" means no Spotify app is open anywhere; open one first.
- The permissions granted are playback read/control only — no library changes,
  no account access.
