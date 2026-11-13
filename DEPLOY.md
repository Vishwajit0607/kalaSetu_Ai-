# Deploying KalaSetu

KalaSetu has three parts, and each one deploys somewhere different.

| Part | Where it goes | Status |
| --- | --- | --- |
| Database, auth, photo storage | **Supabase** (already hosted) | Done, plus one SQL step below |
| API server (`services/api-server`) | **Render** (`render.yaml`) | Ready to deploy |
| Mobile app (`apps/mobile`) | Your phone: **Expo Go** or an **APK built with EAS** (`apps/mobile/eas.json`) | Ready |
| Vercel (`apps/mobile/vercel.json`) | A *web* version of the app | **Not ready**: the app is not set up for the web yet (see Part 6) |

**Why the API is on Render and not Vercel.** Vercel runs short-lived serverless functions. This API needs a normal always-on server: photo uploads are up to 25 MB (Vercel's request limit is about 4.5 MB), AI calls can run for 75 to 120 seconds, and the built-in studio engine loads a model that uses about 1.4 GB of memory.

---

## Part 0. Before you start

1. **Rotate your API keys.** The Gemini, BharatCode, Sarvam, Photoroom and Supabase keys were pasted into chat while building. Treat them as exposed: generate new ones in each vendor's dashboard and use the new ones on Render. The old keys in your local `.env` can then be replaced the same way.
2. **Push the deploy files to GitHub.** Render deploys from GitHub, so it can only see files that are pushed:
   ```bash
   cd /Users/vishwajit/Desktop/E-com/kalasetu-ai
   git add render.yaml DEPLOY.md apps/mobile/eas.json apps/mobile/vercel.json \
           services/api-server/tsconfig.build.json services/api-server/package.json \
           services/api-server/src/services/local-studio.service.ts \
           services/api-server/src/__tests__/studio.test.ts README.md
   git commit -m "Add Render blueprint, EAS config and deploy guide; guard the studio engine's memory"
   git push origin main
   ```

---

## Part 1. Supabase (one SQL step)

Open Supabase, then **SQL Editor**, and run this once. It adds the column that stores extra product photos. Without it, products save but their extra photos are dropped.

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[] NOT NULL DEFAULT '{}';
```

Then check:
- **Storage**: the bucket named `kalasetu-media` exists and is **public** (product photos are shown by URL).
- **Authentication**: nothing to change. The app signs people up with a phone number and password through the API.

Note down these three values; you paste them into Render in Part 2:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the secret key) and `SUPABASE_PUBLISHABLE_KEY`.

---

## Part 2. Deploy the API on Render

1. Create a free account at https://render.com and connect your GitHub account.
2. Click **New +**, then **Blueprint**, and choose the repo `Vishwajit0607/E-com-`. Render finds `render.yaml` at the repo root and shows one service, `kalasetu-api`.
3. Render asks for the values marked `sync: false`. Fill them in:

   | Variable | Where to get it |
   | --- | --- |
   | `PHOTOROOM_API_KEY` | Photoroom dashboard. It must be filled in even if you never use Photoroom (the server refuses to start without it) |
   | `SARVAM_API_KEY` | Sarvam dashboard |
   | `GEMINI_API_KEY` | Google AI Studio |
   | `BHARATCODE_API_KEY` | BharatCode. Optional: leave blank to run Gemini-only |
   | `SUPABASE_URL` | Supabase, Project Settings, API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase, the secret key. **Never put this in the mobile app** |
   | `SUPABASE_PUBLISHABLE_KEY` | Supabase, the publishable key |

   The Blueprint also sets `TRUST_PROXY=true` for you. **If you created the service with Render's manual "New Web Service" form instead, add `TRUST_PROXY` = `true` yourself** (Environment tab). Render puts a proxy in front of the server; without this setting every caller looks like one address, so the audit trail records Render's IP and the login rate limit (10 a minute) is shared by all users at once.

4. Click **Apply**. The first build takes a few minutes. Wait for **Live**.
5. Copy the service URL (it looks like `https://kalasetu-api.onrender.com`; Render adds a suffix if the name is taken).
6. Verify it from your terminal:
   ```bash
   curl https://YOUR-SERVICE.onrender.com/health
   # {"status":"ok","service":"kalasetu-api","version":"1.0.0","uptime_seconds":...}

   curl -i https://YOUR-SERVICE.onrender.com/v1/inventory
   # HTTP 401 and {"error":"unauthorized"...}  <- correct: login is required
   ```

### What the free plan means

- It **sleeps after 15 minutes without a request**. The next request takes about 30 to 60 seconds to wake it, and the app may show a timeout. To keep it awake, add a free monitor (for example UptimeRobot) that calls `/health` every 5 minutes.
- It has **512 MB of memory**. That is enough for everything except the built-in studio engine, which needs about 1.4 GB. On a small instance the engine declines by itself, so a photo comes back as the original, flagged ("studio edit did not finish"), and the server does not crash.
- **Studio photos therefore need one of these:**
  1. Add paid credits to Photoroom (works on the free plan), or
  2. In `render.yaml` change `plan: free` to `plan: standard` (2 GB, paid, check Render's current price). The free built-in engine then runs, about 2 to 4 seconds a photo.

Each time you push to `main`, Render rebuilds and redeploys automatically.

---

## Part 3. Point the mobile app at the deployed API

The app reads its server address from `EXPO_PUBLIC_API_BASE_URL`.

1. Edit `apps/mobile/.env` (it is git-ignored):
   ```
   EXPO_PUBLIC_API_BASE_URL=https://YOUR-SERVICE.onrender.com
   ```
2. Restart Expo with a clean cache so the new value is picked up:
   ```bash
   cd apps/mobile
   npx expo start -c
   ```
3. Open it in Expo Go as before. Your phone no longer needs to be on the same Wi-Fi as your Mac.
4. In `apps/mobile/eas.json`, replace `https://kalasetu-api.onrender.com` (two places) with your real URL.

---

## Part 4. Build an installable Android app (APK)

Expo Go is for development. To give someone the app without Expo Go, build an APK with EAS:

```bash
npm install -g eas-cli
eas login                      # free Expo account
cd apps/mobile
eas init                       # links the project; adds an ID to app.json
eas build --platform android --profile preview
```

When the build finishes, EAS prints a download link and a QR code for the `.apk`. Open it on an Android phone and install it (allow "install from unknown sources").

Two things to know:
- The server URL is baked in at build time (from `eas.json`). If the URL changes, build again.
- The offline sync layer (WatermelonDB) only works in a real build like this, not in Expo Go. It has not been tested on a device, so treat it as unverified.

---

## Part 5. Check everything works

- [ ] `/health` returns `ok` on the Render URL
- [ ] You can sign up and log in from the phone
- [ ] Take a photo in Studio: you get a studio image back (or the honest "did not finish" message on the free plan)
- [ ] Speak a description: the listing appears in Hindi and English
- [ ] Save the product: it appears in Inventory
- [ ] Add an extra photo, save, and open the product: the thumbnail strip shows

### If something fails

| Symptom | Likely cause and fix |
| --- | --- |
| Render build fails with `tsc: not found` | The build command must keep `--include=dev`. It does in `render.yaml` |
| Service starts, then exits with "Invalid environment configuration" | A required key is empty. Render logs list which one |
| App says "connection slow" or times out on the first try | The free instance was asleep. Retry after a minute, or add the `/health` monitor |
| Every request returns 401 | The token and server do not match. Log out and log in again after changing servers, and confirm `SUPABASE_URL` is the same project the accounts live in |
| Photos return unprocessed | Photoroom has no credits and the instance is under 2 GB. See "What the free plan means" |
| Extra photos missing after save | The Part 1 SQL has not been run |

---

## Part 6. Vercel (the web version of the app): not ready yet

`apps/mobile/vercel.json` is written, but **the app cannot run in a browser today**, so deploying it would fail or show a broken page. The gaps, verified in the code:

- `react-native-web` and `@expo/metro-runtime` are not installed, and `app.json` has no `web` section.
- `services/session.ts` stores the login token with `expo-secure-store`, which does not exist on the web.
- `db/` uses WatermelonDB, which needs native code.
- Camera, microphone recording and audio playback need web-specific handling.

To make the web version work, someone has to port those pieces and then test them in a browser. Until then the supported ways to use the app are Expo Go and the APK. When it is ready:

1. `cd apps/mobile && npx expo install react-native-web @expo/metro-runtime`
2. Add `"web": { "bundler": "metro", "output": "single" }` to `app.json`, and make the token storage and offline layer web-safe.
3. Check `npx expo export --platform web` builds, and test the result in a browser.
4. On https://vercel.com: **Add New, Project**, import the repo, set **Root Directory** to `apps/mobile`, and add the environment variable `EXPO_PUBLIC_API_BASE_URL` with your Render URL. The build settings come from `vercel.json`.

---

## Rough monthly cost

| Item | Free option | Paid option |
| --- | --- | --- |
| Supabase | Free tier | Pro if you outgrow it |
| Render API | Free (sleeps when idle, 512 MB) | Standard (2 GB) for the built-in studio engine |
| Photoroom | Out of credits now | Pay for credits, or use the built-in engine |
| Gemini, Sarvam, BharatCode | Each vendor's own limits | Per vendor |
| Android APK | Free with EAS (limited build queue) | Faster builds |

Prices change, so check each vendor's pricing page before you commit.
