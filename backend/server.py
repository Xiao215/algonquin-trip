"""Chat backend for the Algonquin weekend planner.

One job: answer questions about the trip. The plan itself is read from ../docs/trip.json
(the same file the page renders), so editing the itinerary updates both.
Exposed to the internet through Tailscale Funnel; see ../README.md.
"""

import hmac
import json
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).with_name(".env"), override=True)  # .env wins over the shell

DOCS = Path(__file__).resolve().parent.parent / "docs"
TRIP_FILE = DOCS / "trip.json"
MODEL = os.getenv("MODEL", "claude-opus-5-5")
EFFORT = os.getenv("EFFORT", "low")
BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "")
# A local Anthropic-compatible server (e.g. claude-api on :8787) answers on your own Pro/Max plan.
LOCAL_AI = bool(re.match(r"https?://(localhost|127\.0\.0\.1)(:|/|$)", BASE_URL))
FALLBACKS = os.getenv("FALLBACKS", "off" if LOCAL_AI else "default")  # "off" disables server-side refusal fallback
# The backend is public through Funnel, so the passcode is always required.
REQUIRE_CODE = True
TRIP_CODE = os.getenv("TRIP_CODE", "")
if not TRIP_CODE or TRIP_CODE == "change-me":
    raise SystemExit("Set TRIP_CODE in backend/.env (the passcode you type into the chat).")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
PER_IP_LIMIT = int(os.getenv("PER_IP_PER_10MIN", "20"))
DAILY_LIMIT = int(os.getenv("DAILY_LIMIT", "300"))
TZ = ZoneInfo("America/Toronto")


if LOCAL_AI:
    print(f"Using the local AI server at {BASE_URL} (personal use; passcode required).", flush=True)
elif not os.getenv("ANTHROPIC_API_KEY"):
    print("Warning: ANTHROPIC_API_KEY is not set in backend/.env; chat requests will fail.", flush=True)
client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY") or ("unused" if LOCAL_AI else None))

app = FastAPI(title="Algonquin trip chat", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Trip-Code"],
)


# ---------- trip context ----------

def _fmt(hhmm: str) -> str:
    h, m = map(int, hhmm.split(":"))
    return f"{h % 12 or 12}:{m:02d} {'PM' if h >= 12 else 'AM'}"


def _maps(ll) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={ll[0]}%2C{ll[1]}"


def render_trip(t: dict) -> str:
    """Turn trip.json into plain text the model can read (coordinates trimmed to what's useful)."""
    places = t["places"]
    out = [f"# {t['title']}", t["eyebrow"], t["lede"], "", "## Latest conditions"]
    out += [f"- {k}: {v}" for k, v in t["conditions"]]
    out += ["", "## Bookings"]
    for b in t["bookings"]:
        out.append(f"### {b['what']} (for {b['for']}; book: {b['when']})")
        if b.get("cost"):
            out.append(f"Cost: {b['cost']}")
        out.append(b["summary"])
        out += [f"{i}. {step}" for i, step in enumerate(b.get("steps", []), 1)]
        out += [f"- {k}: {v}" for k, v in b.get("facts", [])]
        out += [f"- Tip: {tip}" for tip in b.get("tips", [])]
        out += [f"- Link: {name} {url}" for name, url in b.get("links", [])]
    for key, day in t["days"].items():
        out += ["", f"## {day['title']} ({day['sub']})"]
        n = 0
        for s in day["segs"]:
            when = _fmt(s["start"]) if s["start"] == s["end"] else f"{_fmt(s['start'])}–{_fmt(s['end'])}"
            if s["t"] == "drive":
                line = f"- {when} DRIVE {s['label']}"
                if s.get("note"):
                    line += f". {s['note']}"
                out.append(line)
                continue
            n += 1
            line = f"- {when} STOP {n}. {s['name']} [{t['kinds'].get(s['kind'], s['kind'])}]"
            if s.get("km"):
                line += f" (Hwy 60 km {s['km']})"
            out.append(line)
            for k, v in s.get("facts", []):
                out.append(f"    {k}: {v}")
            if s.get("body"):
                out.append(f"    {s['body']}")
            for tip in s.get("tips", []):
                out.append(f"    Tip: {tip}")
            if s["place"] != "markham":
                out.append(f"    Map: {_maps(places[s['place']]['ll'])}")
    out += ["", "## Before you go"]
    for card in t["prep"]:
        out.append(f"### {card['title']}")
        out += [f"- {i['t']}" + (f" ({i['more']})" if i.get("more") else "") for i in card["items"]]
    out += ["", "## Sources"]
    out += [f"- {name}: {url}" for name, url in t["sources"]]
    out += ["", t["footnote"]]
    return "\n".join(out)


SYSTEM_TEMPLATE = """You are the trip assistant for a small group of friends doing a weekend trip to Algonquin Park and Huntsville, Ontario. They open you from the trip planner page, usually on a phone, sometimes from the car or the trail.

The plan is written from the organizer's point of view: "you" is the driver, who lives in Markham, and "your friend" is picked up at Finch Station. The person asking could be either, so check their name before assuming.

Answer from the trip plan below first. When something isn't in the plan (weather, restaurant hours, current fall colour, road conditions, park alerts, rentals), search the web and say briefly where the answer came from. If the plan and the web disagree, point it out. If you don't know, say so; never make up times, prices or phone numbers.

Keep answers short and practical: lead with the answer in a sentence or two, then a few bullets only if they help. Use plain language. Times are Eastern. Link to Google Maps when someone asks where something is. If someone wants to change the plan, suggest the change and what it affects (timing, bookings), but remind them the page itself only changes when the organizer edits it.

Latency-sensitive; begin your visible answer immediately.

<trip_plan>
{plan}
</trip_plan>"""

_cache: dict = {"mtime": None, "system": None}


def system_prompt() -> str:
    """Re-read trip.json only when it changes, so the cached prompt prefix stays byte-identical."""
    mtime = TRIP_FILE.stat().st_mtime
    if _cache["mtime"] != mtime:
        trip = json.loads(TRIP_FILE.read_text())
        _cache.update(mtime=mtime, system=SYSTEM_TEMPLATE.format(plan=render_trip(trip)))
    return _cache["system"]


WEB_SEARCH = {
    "type": "web_search_20260209",
    "name": "web_search",
    "max_uses": 4,
    "user_location": {
        "type": "approximate",
        "city": "Huntsville",
        "region": "Ontario",
        "country": "CA",
        "timezone": "America/Toronto",
    },
}


# ---------- guard rails: passcode + rate limits ----------

_hits: dict[str, deque] = defaultdict(deque)
_daily = {"day": None, "count": 0}


def check_code(code: str | None) -> None:
    if not REQUIRE_CODE:
        return
    if not code or not hmac.compare_digest(code.strip().encode(), TRIP_CODE.encode()):
        raise HTTPException(401, "Wrong trip code.")


def client_ip(req: Request) -> str:
    # Tailscale Funnel proxies to localhost and passes the visitor's address along.
    fwd = req.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "?")


def rate_limit(ip: str) -> None:
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= PER_IP_LIMIT:
        raise HTTPException(429, "Slow down a little. Try again in a few minutes.")
    today = datetime.now(TZ).date()
    if _daily["day"] != today:
        _daily.update(day=today, count=0)
    if _daily["count"] >= DAILY_LIMIT:
        raise HTTPException(429, "The trip assistant has hit today's question limit.")
    q.append(now)
    _daily["count"] += 1


# ---------- API ----------

class Msg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class ChatIn(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=40)
    context: dict | None = None


@app.get("/api/health")
async def health():
    return {"ok": True, "model": MODEL, "local": LOCAL_AI, "code": REQUIRE_CODE}


@app.post("/api/check")
async def check(x_trip_code: str | None = Header(default=None)):
    check_code(x_trip_code)
    return {"ok": True}


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@app.post("/api/chat")
async def chat(body: ChatIn, request: Request, x_trip_code: str | None = Header(default=None)):
    check_code(x_trip_code)
    rate_limit(client_ip(request))

    msgs = [m.model_dump() for m in body.messages][-20:]
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(400, "The last message must be a question.")
    # merge accidental back-to-back turns from the same role (e.g. after a failed request)
    merged: list[dict] = []
    for m in msgs:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append(dict(m))

    # Per-request details go in the latest user turn, never in the system prompt (keeps it cacheable).
    now = datetime.now(TZ).strftime("%A %B %-d, %Y, %-I:%M %p")
    ctx = [f"Right now it is {now} Eastern."]
    if body.name.strip():
        ctx.append(f"Asked by {body.name.strip()}.")
    if body.context:
        view = {k: str(v)[:120] for k, v in body.context.items() if k in ("day", "time", "looking_at") and v}
        if view:
            ctx.append("On the planner they're viewing: " + ", ".join(f"{k}={v}" for k, v in view.items()) + ".")
    merged[-1]["content"] = f"<context>{' '.join(ctx)}</context>\n\n{merged[-1]['content']}"

    return StreamingResponse(
        answer(merged),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def answer(messages: list[dict]):
    extra = {}
    if FALLBACKS != "off":
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": FALLBACKS}
    tools = [WEB_SEARCH]
    try:
        for _ in range(4):  # a long web search can pause the turn; resume it a few times at most
            try:
                stream_cm = client.beta.messages.stream(
                    model=MODEL,
                    max_tokens=16000,
                    system=[{"type": "text", "text": system_prompt(), "cache_control": {"type": "ephemeral"}}],
                    messages=messages,
                    tools=tools,
                    output_config={"effort": EFFORT},
                    **extra,
                )
                stream = await stream_cm.__aenter__()
            except anthropic.BadRequestError as e:
                # Some local servers don't offer web search; answer from the plan alone instead.
                if tools and "tool" in str(e).lower():
                    print("[chat] web search not available on this AI server; continuing without it", flush=True)
                    tools = []
                    continue
                raise
            try:
                async for event in stream:
                    if event.type == "text":
                        yield sse({"type": "text", "text": event.text})
                    elif event.type == "content_block_start":
                        kind = event.content_block.type
                        if kind == "server_tool_use":
                            yield sse({"type": "status", "text": "Searching the web"})
                        elif kind == "web_search_tool_result":
                            yield sse({"type": "status", "text": "Reading results"})
                final = await stream.get_final_message()
            finally:
                await stream_cm.__aexit__(None, None, None)

            u = final.usage
            print(f"[chat] stop={final.stop_reason} in={u.input_tokens} cache_read={u.cache_read_input_tokens} out={u.output_tokens}", flush=True)
            if final.stop_reason == "pause_turn":
                messages.append({"role": "assistant", "content": final.content})
                continue
            if final.stop_reason == "refusal":
                yield sse({"type": "error", "message": "The assistant couldn't answer that one. Try rephrasing."})
            break
    except anthropic.RateLimitError:
        yield sse({"type": "error", "message": "The AI service is busy. Try again in a minute."})
    except anthropic.AuthenticationError:
        print("[chat] Anthropic authentication failed: check ANTHROPIC_API_KEY in backend/.env", flush=True)
        yield sse({"type": "error", "message": "The trip server's AI key isn't set up right."})
    except anthropic.APIStatusError as e:
        print(f"[chat] API error {e.status_code}: {e.message}", flush=True)
        yield sse({"type": "error", "message": f"The AI service returned an error ({e.status_code})."})
    except anthropic.APIConnectionError:
        yield sse({"type": "error", "message": "The trip server couldn't reach the AI service."})
    except Exception as e:  # e.g. no API key configured: the SDK raises before sending anything
        print(f"[chat] {type(e).__name__}: {e}", flush=True)
        yield sse({"type": "error", "message": "The trip server hit an error. Tell the organizer."})
    yield sse({"type": "done"})


# ---------- the site itself ----------
# The backend also serves docs/, so one address gives you the page and the chat.

@app.get("/config.js", include_in_schema=False)
async def config_js():
    # Served from here, the page should talk to this same server rather than the URL in config.js.
    js = (DOCS / "config.js").read_text()
    js = re.sub(r'apiBase:\s*"[^"]*"', 'apiBase: ""', js)
    return Response(js, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=DOCS, html=True), name="site")


if __name__ == "__main__":
    import uvicorn

    # Bind to localhost only; Tailscale Funnel is what makes it reachable from outside.
    port = int(os.getenv("PORT", "8790"))
    print(f"Site + chat: http://localhost:{port}/", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
