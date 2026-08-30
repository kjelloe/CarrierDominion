# Deploying Carrier Dominion

The generic, publishable version. The real host, ports, domains, keys and the
actual deploy script live in the private `ops/` folder (a symlink into the
operator's own repo) and never enter this one.

## What the server is

One Node process (`node server/index.js`). It serves the static client, the
websocket war, `/healthz` and `/watch`. There is no build step, no bundler,
and exactly one runtime dependency (`ws`):

```bash
node --version          # >= 20
npm ci --omit=dev       # installs ws, and nothing else
node server/index.js
```

Everything is environment variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8135 | this game's claimed port on a shared box |
| `HOST` | 127.0.0.1 | loopback by default — the proxy talks to it, the world talks to the proxy |
| `SEED` | 20260818 | the war, when nobody chooses in the room |
| `SPEED` | 1 | starting time compression |
| `LOBBY` | 1 | hold the war in a room with a join code until the host starts it |
| `WATCH` | 1 | the playtest watchdog, served at `/watch` |
| `SAVE` | data/autosave.json | war autosave every 30 s and on shutdown; `0` disables |
| `RESUME` | 0 | `1` resumes the autosave strictly (exits with the reason if it cannot); `auto` resumes when possible and starts fresh with a notice when not |

## The shape of a shared box

The doctrine this family of games deploys under: one nginx with TLS
(certbot), every game bound to loopback on its own claimed port, nginx
proxying one hostname to each. The game process never faces the internet and
never owns port 443.

```nginx
# /etc/nginx/sites-available/carrierdominion  (hostname per ops/)
server {
    server_name <hostname>;
    location / {
        proxy_pass http://127.0.0.1:8135;
        proxy_http_version 1.1;
        # The war is a websocket; without these it is a page that never moves.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 7d;
    }
}
```

## A unit file

```ini
[Unit]
Description=Carrier Dominion
After=network.target

[Service]
WorkingDirectory=/opt/carrierdominion
ExecStart=/usr/bin/node server/index.js
Environment=PORT=8135
# `auto`, not `1`: a crash or a deploy costs nobody their war - the autosave
# replays to the exact tick it left - but a save the code has outgrown starts
# fresh with a notice instead of crash-looping the unit.
Environment=RESUME=auto
Restart=on-failure
User=carrierdominion

[Install]
WantedBy=multi-user.target
```

Note the pairing: `Restart=on-failure` **plus** `RESUME=auto` is what makes
the service self-healing without either eating anyone's war or crash-looping
on a save an engine change has outgrown. `auto` also handles the very first
boot, when no autosave exists yet. Strict `RESUME=1` is for a human at a
terminal who would rather be told than fall back.

## Updating

```bash
cd /opt/carrierdominion
git fetch && git checkout <the release>
npm ci --omit=dev
systemctl restart carrierdominion
```

The restart writes a final autosave on the way down and resumes it on the way
up — **unless the engine changed in a way that moves hashes**, in which case
resume refuses with a message: under `RESUME=auto` the service starts a fresh
war and says so, under `RESUME=1` it exits. That is deliberate either way: a
saved war replayed under different rules is a different war wearing the same
name. Deploy engine-changing releases between wars, or accept the fresh start.

## Watching it

| Endpoint | What it answers |
|---|---|
| `/healthz` | tick, state hash, seats, status (`lobby`/`running`), whether a room is waiting (`hasJoinCode`), whether this boot resumed, rss |
| `/watch` | the playtest watchdog's findings — impossible values, stalls, slow ticks — one line per kind with the first tick and a count |

A monitor should read `status` from `/healthz`, not the tick: a war waiting in
its room does not tick, and that is health, not a hang.

**Neither endpoint carries the join code.** `/healthz` is the natural thing to
put behind a public hostname, and a room's code is the only thing between a
stranger and a seat — so the code is not in the health object at all, only
`hasJoinCode: 0|1`. It is printed to the log at boot, which is where the host
reads it. If you put either endpoint on the public internet, that is the
property you are relying on; `test/server_ws.test.js` holds it.

## What this file deliberately is not

Hostnames, box addresses, users, keys, the port ledger and the real deploy
script are in `ops/` (private). If you are not the operator, this file plus a
box of your own is everything you need; if you are, `ops/README.md` has the
rest.
