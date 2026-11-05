# DXBMUN 27'

Website and E-Chits platform for DXB MUN 2027 at Indian High School, Dubai. Confirm event details and timings with the organizers; the schedule and committee agendas on the site may change.

## Features
- Home, About, Committees pinwheel (19 committees), 3-day schedule, local Wellness checklist with a completion celebration, Resources and floor timer
- Three-second DXB MUN opening cinematic (automatically skipped for reduced-motion preferences)
- Committee wheel selections include a short overview of each committee
- Shared speaking order and live speaker timer at `/timer.html`; the committee chair can add and reorder delegates during GSL or moderated caucus, set per-speech and total caucus times, run an unmoderated caucus countdown, and use a separate general-purpose timer
- E-Chits: log in with one access code (DEL/CHR/ADN + 5 digits)
  - Delegates: send POI/Other chits, private/public directives, and resolutions with an optional Google Docs/Drive URL or PDF/DOC/DOCX/ODT/TXT attachment (max 3 MB); reply to received chits
  - Choosing Directive opens a private/public visibility prompt; private directives remain visible only to the sender and committee chair, while approved public directives are visible to all logged-in users
  - Chairs: review pending messages for their committee and view each delegate's chit history
  - Admins: review all pending messages and use the E-Chits directory
  - Chits, including POIs, remain in inboxes and are retained for chair history

## Access codes
8 characters: `DEL` / `CHR` / `ADN` followed by 5 digits (e.g. `DEL12345`).
Codes, names and allocations come from `users.csv`
(columns: `code,name,committee,country`).
`users.sample.csv` contains public demo codes for local testing only. Do not use those codes or the sample list for a live conference.

## Run locally
    pip install -r requirements.txt
    uvicorn app:app --host 127.0.0.1 --port 5000 --reload
Then open http://127.0.0.1:5000

Direct local startup uses the sample access codes and a development-only session key. To use another port, set `PORT` (for example, `PORT=8000 uvicorn app:app --host 127.0.0.1 --port 8000 --reload`). Never expose the local server or use the sample list in production.

## Deploy to Vercel
Vercel detects the FastAPI application in `app.py` and serves assets from `public/`. E-Chits uses PostgreSQL in production because Vercel's local filesystem is temporary; local `uvicorn app:app --reload` continues to use SQLite.

If none of `SECRET_KEY`, `DATABASE_URL`, or `USERS_CSV` is set, E-Chits runs in public demo mode with the sample accounts and temporary SQLite storage under `/tmp`; no environment-variable setup is needed to try it. Demo accounts and data are public, and data may be lost or differ between function instances. Do not use this mode for real delegates or sensitive messages. Live use still requires the production configuration below.

1. Create a PostgreSQL database (for example, on [Neon](https://neon.tech/)) and copy its pooled connection string. E-Chits reuses a bounded connection pool per application instance; `DB_POOL_MAX_SIZE` defaults to `5` and can be set from `1` to `20` to match the database connection budget.
2. Import this Git repository as a project in [Vercel](https://vercel.com/). Keep the project root at the repository root and use the detected Python/FastAPI settings.
3. Add these environment variables to the Vercel project for Production:
   - `DATABASE_URL`: the private PostgreSQL connection string.
   - `SECRET_KEY`: a long, unique random value.
   - `USERS_CSV`: the complete private delegate CSV, including the `code,name,committee,country` header.
4. Deploy from the Vercel dashboard. Subsequent commits to the connected branch deploy automatically.
5. Confirm the page and assets load, then test E-Chits using an access code from the private CSV. Review Vercel runtime logs and the database if requests fail.

Do not commit `users.csv` or put real access codes in a public asset. Use a separate database and sanitized access-code list for Preview deployments. Database schema changes are serialized across application instances, and user records are synchronized without replacing unchanged records. The database connection limit is shared by all running application instances: size the provider's pooled connection URL and `DB_POOL_MAX_SIZE` for the deployment's instance count. A successful 800–1,000-delegate event load still depends on the selected hosting plan, database limits, network capacity, and a load test against the actual production configuration; local testing cannot certify those provider limits.

## Deploy to Render
For Render, use the start command `uvicorn app:app --host 0.0.0.0 --port 8000`.
Store the real delegate list as a Secret File called `users.csv`.
Set `SECRET_KEY` to a long random value and set `SESSION_COOKIE_SECURE=1` when serving the site over HTTPS. Production startup requires `SECRET_KEY` and a real `users.csv`/`USERS_FILE`; it will not fall back to demo accounts.

## Editing content
- Committee selector and shared interactions: `public/js/main.js`
- Committee descriptions and wheel content: `templates/index.html`
- Shared speaking list and timer: `public/timer.html`, `public/js/timer.js`, and `app.py`
- Colours, homepage layout and hero photo: `public/css/home.css` and `public/images/hero-photo.jpg`
- E-Chits presentation and behavior: `public/css/echits.css` and `public/js/echits.js`
