# KalaSetu AI

Voice-first mobile commerce assistant for Indian artisans, handloom weavers and
micro-entrepreneurs. Photograph a craft, describe it out loud in your own
language, and get studio photography, bilingual SEO copy, a defensible price and
one-tap syndication to ONDC, GeM and WhatsApp B2B buyers.

Built for someone who does not type and may not read English. Hindi and English
are supported - exactly two, each with a real, parity-checked dictionary.

## Monorepo layout

```
kalasetu-ai/
├── apps/mobile          Expo SDK 52 · Expo Router v4 · NativeWind v4 · WatermelonDB
└── services/api-server  Node 22 · Fastify 5 · Supabase
```

## Getting started

```bash
npm install                       # workspace root
cp .env.example services/api-server/.env
cp .env.example apps/mobile/.env  # keep only the EXPO_PUBLIC_* lines

# Database (needs the direct Postgres URI, not the REST URL)
DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
  npm run db:migrate

npm run dev                       # api-server + expo, in parallel
```

No Redis or job queue to run: every AI call is synchronous.

**Running on a phone.** The app works in **Expo Go** (`npx expo start`, scan the
QR, same Wi-Fi as the Mac). Set `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env`
to the Mac's LAN address - `localhost` on a phone means the phone itself. Expo
Go has no WatermelonDB native module, so the offline outbox is inert there; a
development build (`npx expo run:android`) enables it.

### Required credentials

| Variable | Service | Used for |
| --- | --- | --- |
| `PHOTOROOM_API_KEY` | Photoroom Image Editing API v2 | Background removal, AI relight, soft shadow |
| `SARVAM_API_KEY` | Sarvam AI | Saaras V4 STT, Mayura translate, Bulbul V4 Flash TTS |
| `GEMINI_API_KEY` | Google Gemini | Structured bilingual catalog + pricing (model chain, see `gemini.service.ts`) |
| `BHARATCODE_API_KEY` | BharatCode (optional) | Fallback LLM when Gemini is overloaded |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Postgres, Auth admin, media storage |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase | Password sign-in and refresh (falls back to the secret key) |

## Verification

```bash
npm test          # backend (vitest) + mobile (jest)
npm run typecheck # tsc --noEmit, both workspaces, strict
```

The backend suite includes the security properties, not just the happy path:
every protected route 401s with no token, forged / expired / wrong-issuer /
service-role tokens are rejected against a locally-signed key, and media-URL
ownership (own upload accepted; another artisan's, a `file://` path, a foreign
host and `..` traversal all rejected). The mobile suite pins the auth client
(one shared refresh, no logout on a dropped connection) and the regressions
listed under *Pipeline bugs fixed* below.

## Design system

Tokens live in one place — [`apps/mobile/theme/tokens.ts`](apps/mobile/theme/tokens.ts) —
and `tailwind.config.js` re-exports them so Skia, Reanimated and
`expo-linear-gradient` read the same values as the utility classes.

| Token | Hex | Usage |
| --- | --- | --- |
| Canvas Obsidian | `#060705` | Primary screen background |
| Surface Charcoal | `#11150E` | Translucent bento cards |
| Surface Elevated | `#181E13` | Modals and bottom sheets |
| Electric Lime | `#A8EB34` | Primary accent and highlights |
| Lime Gradient End | `#78C214` | Active bento card gradient |
| Ambient Olive Glow | `#4A6B1D` | Background radial spotlights |
| Border Hairline | `#2C381E` | Card and pill outlines |
| Text Pure White | `#FFFFFF` | Headings and values |
| Text Muted Sage | `#9BA394` | Subtitles and helper labels |
| Text Inverse Dark | `#080A06` | Text on solid lime surfaces |

The palette is tuned for one constraint: readability in direct Indian afternoon
sun on a 400-nit budget handset. Near-black canvas against a 90%-luminance
chartreuse clears WCAG AAA at 16px, where a softer brand green washes out.

Signature components, all in `apps/mobile/components/ui/`:

- `SplitHeading` — white subject + lime action phrase, wraps safely in Devanagari and Tamil
- `BentoStepCard` — the 01/02/03 strip; the active card lifts 14px and fills with the lime gradient
- `LimeCircleButton` — 48px lime disc, black 45° diagonal arrow, haptics, spoken label on long-press
- `GlowingTimeline` — 2px lime rail with 10px pulsing nodes; one shared animation drives all stages
- `HaloProductStage` — concentric HUD rings over a Skia radial glow, with the right-edge action dock
- `SplitBadgePill` — two-tone marketplace sync pill

## Architecture notes

## Accounts

Identity is a **mobile number and password**, backed by Supabase Auth.

Supabase's own phone login needs an SMS provider this project does not have, and
its email login sends confirmation mail through a shared sender capped at a few
messages an hour. So the server creates *pre-confirmed* accounts through the
admin API, keyed on a deterministic internal address derived from the phone
number (`91XXXXXXXXXX@phone.kalasetu.invalid` - `.invalid` is reserved by
RFC 2606 and can never receive mail, so it is a login key, never a contact
channel).

- **Tokens** are Supabase's ES256 JWTs, verified locally against the project's
  public JWKS: no network call per request and no shared secret on the server.
- **Identity comes only from the token.** No route reads an artisan id from the
  query or body; before accounts, any caller could read or change any catalog by
  sending a different UUID. Inventory, QR tags, stock changes and re-edits are
  all scoped to the caller.
- The artisan row's id **is** the auth user's id, which is what makes the
  `auth.uid() = id` row-level-security policies mean something.
- Sign-out wipes the query cache and the in-progress draft, because several
  people share a phone.
- **Account deletion** is in the app (Google Play requires it): it removes the
  login, the profile, every product and every stored photo and voice note.
- Tokens are held in the platform keystore (SecureStore), not the profile file.

**Known gap: there is no password recovery.** That needs real phone OTP, which
needs an SMS provider (MSG91, Twilio). Until then a forgotten password means a
new account. Passwords are Supabase's (minimum 6 characters).

Anonymous callers can reach only the speech endpoints, because the onboarding
screens speak and transcribe before an account exists. They are rate-limited per
IP (40/min vs 240/min signed in) since every call spends Sarvam credits.

## New-product pipeline

Photo -> studio -> voice -> listing -> price -> save. Media never passes through
the phone as bytes after the first upload:

1. The capture is **downscaled to 1600px** on the phone (a raw 12MP frame is
   4-6MB; Photoroom's output is capped at 1600px anyway).
2. `POST /v1/vision/edit` uploads it, runs Photoroom, stores the result, and
   returns **hosted URLs**. Re-edits (backdrop, relight, shadow) send
   `raw_image_url` instead of the photo, and the replaced render is deleted.
3. The voice note is transcribed and stored (`?store=true`).
4. `POST /v1/catalog/generate` takes the stored image **URL** - the server
   fetches it itself - and returns the listing. Costs and size are optional
   here: they are not known yet, and are never invented.
5. `POST /v1/catalog/products` accepts only URLs the server handed out for
   *that artisan*.

### Pipeline bugs fixed

- Spoken prompts **re-fired on every re-render** (an unstable `t` in `useEffect`
  deps) - the profile screen re-spoke its question on each keystroke.
- The pricing screen made a **request loop** (~every 420ms): it depended on the
  whole store object, which changes on every `set`, including its own write.
- Studio backdrop/relight/shadow changes re-ran the edit with the **previous**
  setting (stale closure), and `"false"` parsed as `true` server-side
  (`z.coerce.boolean`), so the toggles never worked at all.
- Products were saved with **on-device `file://` paths** as their photos; the
  voice note was never uploaded; zero dimensions were sent (a 400 at the last
  button); the saved product did not appear in inventory for a minute.
- The AI was fed **invented dimensions** (a padded 30x20x2) and wrote them into
  listings; pricing was computed from zero costs and shown before any were
  entered.
- A timeout was reported as "offline", and the offline message claimed the work
  was "saved on the phone" - it was not.
- `en-IN` transcripts were "translated" `en-IN -> en-IN`.
- Out-of-order price responses could overwrite newer ones; a stale price could
  be committed before its recalculation landed; the Studio tab stayed on an
  empty stage after a save; stock quantity was hard-coded to 1.

## Offline - what is real

Be clear-eyed about this one. The WatermelonDB layer ([`apps/mobile/db/`](apps/mobile/db/))
and outbox ([`services/offlineQueue.ts`](apps/mobile/services/offlineQueue.ts))
exist, but **no screen reads the local database**, and the outbox holds only two
replayable jobs: `marketplace_export` and `stock_delta`. The new-product pipeline
is **online-only** and fails honestly ("no internet, try again") when offline.

An earlier version queued the pipeline's steps and told the artisan their work
was saved. It was not: each job needed a local product row nothing created. Real
offline capture is a feature, not a few job handlers - local draft rows, a media
upload queue, conflict handling - and needs a development build to test.

**The pricing floor is deterministic, never AI** ([`pricing.service.ts`](services/api-server/src/services/pricing.service.ts)).
Cost-plus math owns the floor; Gemini's market benchmark can only raise the
ceiling, blended 60/40, and is discarded outright if it would price below the
artisan's own cost. Artisans in these clusters are routinely talked down by
middlemen, so the full breakdown is visible and `explainPricing` reads it aloud, in the artisan's language:
a price you can explain is a price you can hold.

**Every AI vendor has a working fallback.** Photoroom down → the original frame
comes back flagged so the artisan can re-run it. Gemini down → BharatCode, then a
draft built from the transcript alone. Sarvam TTS down → the alert still ships,
silently. A `429`/`5xx` retries with jittered backoff; a `401` fails fast
instead of burning the artisan's battery on a bad key.

**Errors speak.** Every API error carries a `spoken_hi` field (named for the
original Hindi-only version; it is in the language of the `X-Lang` header) that
the client feeds straight to Bulbul TTS. Silent failure is the one outcome this app cannot
afford — an artisan who hears nothing assumes the phone ate their work.

## Deviations from the brief

1. **Luminance metering is post-capture, not live.** The brief specifies a
   real-time luminance meter in the viewfinder. `expo-camera` exposes no
   per-frame callback, and a true live meter needs a frame processor
   (react-native-vision-camera) — a second camera stack. Instead,
   [`services/luminance.ts`](apps/mobile/services/luminance.ts) grades the
   captured frame with one Skia decode (Rec. 709 luminance, shadow/highlight
   clipping) and speaks "move towards the light" with a retake prompt before
   any Photoroom call is spent. Same failure caught, one beat later.

2. **Accounts replaced `artisan.routes.ts`.** The first version let anyone
   create or overwrite a profile by phone number with no credentials; it is now
   `auth.routes.ts` (signup / login / refresh) plus `/v1/me`.

3. **Two languages, not nine.** Hindi and English only. The other seven were
   wired for voice but had no UI dictionary, so they fell back to Hindi text
   read by the wrong voice; removing them beat shipping them half-done.

## Build phase status

| Phase | Status |
| --- | --- |
| 1 · Workspace & design system | Complete — Turborepo, tokens, all six UI primitives |
| 2 · Database & offline storage | Postgres schema + RLS live. WatermelonDB/outbox exist but are not wired to any screen — see *Offline - what is real* |
| 3 · AI Photo Studio | Complete — Photoroom proxy, halo stage, before/after, backdrops |
| 4 · Voice & catalog pipeline | Complete — Saaras/Mayura/Bulbul + Gemini, bound to the timeline |
| 5 · Pricing calculator | Complete — sliders, voice cost entry, two-tier bento, Hindi readout |
| 6 · Inventory & syndication | Complete — voice stock, QR tags, lookbook PDF, ONDC/GeM/B2B adapters |
| 7 · Accessibility & verification | Audio readouts, 56px targets, security + pipeline regression tests |

Two items in Phase 7 need real hardware and are not claimed as verified: the
60fps measurement on a low-end Android, and end-to-end runs against live
Photoroom/Sarvam/Gemini credentials *from the app on a device*. Animations were written to that budget —
all transforms and opacity on the UI thread, one shared value per timeline, Skia
for the glows instead of stacked translucent views — but "written for 60fps" is
not "measured at 60fps".
