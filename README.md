# DXBMUN 27'

Website and E-Chits platform for DXB MUN 2027 at Indian High School, Dubai. Confirm event details and timings with the organizers; the schedule and committee agendas on the site may change.

## Features
- Home, About, Committees pinwheel (19 committees), 3-day schedule, local Wellness checklist, Resources and floor timer
- E-Chits: log in with one access code (DEL/CHR/ADN + 5 digits)
  - Delegates: send chits, directives and resolutions, and reply to received chits
  - Chairs: review pending messages for their committee
  - Admins: review all pending messages and use the E-Chits directory

## Access codes
8 characters: `DEL` / `CHR` / `ADN` followed by 5 digits (e.g. `DEL12345`).
Codes, names and allocations come from `users.csv`
(columns: `code,name,committee,country`).
`users.sample.csv` contains public demo codes for local testing only. Do not use those codes or the sample list for a live conference.

## Run locally
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000

Direct local startup uses the sample access codes and a development-only session key. To use another port, set `PORT` (for example, `PORT=8000 python app.py`). Never expose the local server or use the sample list in production.

## Deploy to Vercel
Vercel detects the Flask application in `app.py` and serves assets from `public/`. E-Chits uses PostgreSQL in production because Vercel's local filesystem is temporary; local `python app.py` continues to use SQLite.

1. Create a PostgreSQL database (for example, on [Neon](https://neon.tech/)) and copy its pooled connection string.
2. Import this Git repository as a project in [Vercel](https://vercel.com/). Keep the project root at the repository root and use the detected Python/Flask settings.
3. Add these environment variables to the Vercel project for Production:
   - `DATABASE_URL`: the private PostgreSQL connection string.
   - `SECRET_KEY`: a long, unique random value.
   - `USERS_CSV`: the complete private delegate CSV, including the `code,name,committee,country` header.
4. Deploy from the Vercel dashboard. Subsequent commits to the connected branch deploy automatically.
5. Confirm the page and assets load, then test E-Chits using an access code from the private CSV. Review Vercel runtime logs and the database if requests fail.

Do not commit `users.csv` or put real access codes in a public asset. Use a separate database and sanitized access-code list for Preview deployments. The database tables and user list are initialized when the Flask app starts.

## Deploy to Render
For Render, use the start command `gunicorn app:app`.
Store the real delegate list as a Secret File called `users.csv`.
Set `SECRET_KEY` to a long random value and set `SESSION_COOKIE_SECURE=1` when serving the site over HTTPS. Production startup requires `SECRET_KEY` and a real `users.csv`/`USERS_FILE`; it will not fall back to demo accounts.

## Editing content
- Committee selector and shared interactions: `public/js/main.js`
- Colours, homepage layout and hero photo: `public/css/home.css` and `public/images/hero-photo.jpg`
- E-Chits presentation and behavior: `public/css/echits.css` and `public/js/echits.js`
