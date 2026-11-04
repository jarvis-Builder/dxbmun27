# DXBMUN 27'

Website and E-Chits platform for DXBMUN 27' (23-25 April 2027, Dubai). Confirm event details and timings with the organizers; the schedule and committee agendas on the site may change.

## Features
- Home, About, Committees pinwheel (22 committees), 3-day schedule, local Wellness checklist
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

## Deploy
For Render, use the start command `gunicorn app:app`.
Store the real delegate list as a Secret File called `users.csv`.
Set `SECRET_KEY` to a long random value and set `SESSION_COOKIE_SECURE=1` when serving the site over HTTPS. Production startup requires `SECRET_KEY` and a real `users.csv`/`USERS_FILE`; it will not fall back to demo accounts.

## Editing content
- Committees and schedule: `static/script.js` (`COMMITTEES` and `SCHEDULE`)
- Colours: top of `static/style.css` (`:root`)
- Hero illustration: `static/hero.svg`