# The Rekt Runner (Farcaster Mini App)

Deployed domain (must stay consistent everywhere):
- https://rekt-runner.vercel.app/

## Run locally
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Critical: Sign the manifest
Your Mini App manifest is at:
- `public/.well-known/farcaster.json`

You **must** replace:
- `accountAssociation.header`
- `accountAssociation.payload`
- `accountAssociation.signature`

Generate these via:
- Base Build Preview → Account Association (or Farcaster Manifest Tool)

## Tip configuration (required)
In `src/main.js`, set:
- `RECIPIENT` (checksummed EVM address)
- `BUILDER_CODE` (provided by the program)

If either is missing/invalid, tipping is disabled by design.

## Leaderboard
This project ships with a **local** demo leaderboard (localStorage).
For a production leaderboard, add a backend (e.g., Vercel KV / Postgres) and replace the local leaderboard functions.

