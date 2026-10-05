# Algonquin Thanksgiving Weekend

Trip planner for Oct 10–11, 2026: a day-by-day timeline with a forecast and totals for each day, a Google map that shows whichever stop you open, step-by-step booking guides and packing checklists, plus a floating chat assistant (Ctrl/⌘+K) that knows the plan and can search the web.

The forecast comes from [Open-Meteo](https://open-meteo.com/) (free, no key) and shows up about two weeks before each day. Booking prices and steps were checked against Ontario Parks and Algonquin Outfitters on Oct 4, 2026; edit them in `trip.json` if anything changes.

```
docs/                 static site, served by GitHub Pages
  index.html          page shell, map column, floating chat box
  styles.css
  trip.json           THE PLAN: itinerary, bookings, packing list, route shapes (page and AI both read this)
  app.js              timeline, day-at-a-glance, Google map, bookings + checklists
  chat.js             trip assistant
  config.js           backend URL + Google Maps key
backend/
  server.py           FastAPI + Claude API, streams answers
  .env                secrets (not committed)
scripts/
  build_routes.py     regenerates the route lines in trip.json
start.sh              runs the backend and publishes it with Tailscale Funnel
```

## Google Maps

The page works without a key: it shows Google's basic embedded map, which jumps to each stop (or shows directions for each drive) as you move the slider.

With a key you get the full map: every drive drawn on real roads, the hike and paddle routes, numbered stop pins, and a "you" dot that moves with the slider. To get one:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (Google asks for a billing account; a few friends' use stays well within the free monthly usage).
2. Enable **Maps JavaScript API**.
3. **Credentials → Create credentials → API key.** Restrict it to websites `https://xiao215.github.io/*` and `http://localhost:8000/*`, and to the Maps JavaScript API only. The key is visible to anyone who loads the page; that's normal for Maps keys, and the website restriction is what protects it.
4. Paste it into `googleMapsKey` in `docs/config.js`.
5. Optional: under **Map Management**, create a JavaScript map ID and put it in `googleMapId`. Without one the page uses Google's demo map ID.

## Run the backend

1. Put your Anthropic API key in `backend/.env` (`ANTHROPIC_API_KEY=...`). `TRIP_CODE` in the same file is the passcode friends type the first time they open the chat. Share it in your group chat, not on GitHub.
2. Make sure the Tailscale app is running, then:

   ```bash
   ./start.sh
   ```

   This serves the backend on `127.0.0.1:8790` and publishes it at
   `https://xiaos-macbook-pro.tail3d8516.ts.net:8443`. Port 443 is left alone because another app on this Mac already uses it.

The chat only works while your Mac is awake, online and running `start.sh`. To unpublish it:

```bash
tailscale funnel --https=8443 off
```

The backend serves the site too: after `./start.sh`, open **http://localhost:8790/** on this Mac, or **https://xiaos-macbook-pro.tail3d8516.ts.net:8443/** on your phone (with Tailscale on). The API lives under `/api/`, so `/api/health` is the only API address you can open directly in a browser.

### Using your local claude-api (personal use only)

`backend/.env` has `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, so answers come from your local claude-api on your Pro/Max plan. In this mode `./start.sh` doesn't use Funnel; it uses `tailscale serve`, which makes the backend reachable only from your own devices on your tailnet (your phone needs the Tailscale app). If friends ever need the chat, remove that line and add an API key instead: a subscription can't serve other people.

## Host the frontend

Push this folder to a GitHub repo, then go to **Settings → Pages** and pick **Deploy from a branch**, branch `main`, folder `/docs`. The site will be at `https://xiao215.github.io/<repo>/`.

If the page is ever served from a different origin, add it to `ALLOWED_ORIGINS` in `backend/.env`.

## Edit the plan

Change `docs/trip.json` and push. If you change where a drive starts or ends, rebuild the route lines (uses the free OSRM and OpenStreetMap services):

```bash
python3 scripts/build_routes.py
```

The backend re-reads the file when it changes (it reads the local copy, so pull on the Mac running the backend). Stops are `{"t":"stop", "place": <id in places>, "start":"HH:MM", "end":"HH:MM", "kind", "name", "verb", "body", "facts", "tips"}`. Drives are `{"t":"drive", "path":[place ids or [lat,lon]], "start", "end", "label"}`.

## Local testing

```bash
python3 -m http.server 8000 --directory docs
```

Then open `http://localhost:8000/?api=http://localhost:8790` to point the chat at a local backend.

## Knobs (backend/.env)

| Setting | Default | |
|---|---|---|
| `MODEL` | `claude-opus-5-5` | |
| `EFFORT` | `low` | Fast, cheap chat replies. Use `medium` for more careful answers. |
| `FALLBACKS` | `default` | Server-side refusal fallback. Set `off` if the API ever rejects it. |
| `PER_IP_PER_10MIN` / `DAILY_LIMIT` | `20` / `300` | Abuse guards, since the URL is public. |
