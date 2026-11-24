# Fieldwork Shop

An example Next.js shop with a Sanity-backed product catalog and a separate Sanity Studio. The catalog index, product pages and featured product read published Sanity content. The repository ships with synthetic catalog, draft and editorial fixtures for testing.

## Local development

Copy `.env.example` to `.env.local` and set your Sanity project and dataset. The API token is optional for a public dataset. Keep tokens on the server.

Run `npm ci` and `npm run dev` for the storefront on port 3000. For Studio, run `npm ci` under `studio/`, set `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`, then run `npm run dev` in that directory. Studio runs on port 3333.

## Tracks runs

Tracks prepares an isolated dataset and writes the task's local testing instructions to `.sanity-eval/contract.json`. Follow those notes to run the check for your task. Keep changes within the assigned sandbox dataset.

The preview verifier uses Chromium already installed in the Tracks sandbox. To run that verifier outside Tracks, install your local Playwright browser with `npx playwright install chromium`.
