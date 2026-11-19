# Deploying the Node backend over the Python one

One-time migration. The live box has been running FastAPI/uvicorn; this replaces
it with the Node backend on the same port, same database, same evidence folder.

Run every command on the EC2 box. Do not skip step 0 or step 5 — they are the
two places where this can fail safely rather than during the demo.

---

## What carries over, and what does not

| | Carries over |
|---|---|
| SQLite schema | Yes — identical, column for column |
| Evidence files | Yes — same `data/evidence/users/<id>/` layout |
| Session cookies | Yes — both hash tokens with SHA-256 |
| Agent API key | Yes — same SHA-256 digest, so the key on disk stays valid |
| Env vars | Yes — `GROQ_API_KEY`, `GROQ_MODEL`, `THREAD_COOKIE_SECURE` |
| **Passwords** | **No** — see below |

Python hashed passwords with Argon2 (`pwdlib`). Node hashes with scrypt and
returns `false` for anything that is not `scrypt$...`. **Every existing account
will be unable to sign in** until step 8 rewrites the hash.

Do not fix this by re-registering. A new account gets a new user id, and
evidence is stored under the user id, so every batch already collected would
become invisible.

---

## 0. Check the Node version (this decides everything)

```
node -v
```

The backend uses `node:sqlite`, which is stable from **Node 23.4** and ships
unflagged in Node 24+. On Node 22 it needs `--experimental-sqlite`; on Node 20
or older it does not exist at all and the server will not start.

If it is below 24, install Node 24 before going further and re-check. Nothing
else on the box should be affected, but note that `nirikshak.site` runs on
ports 3000/3001/4000 — leave those processes alone.

## 1. Record what is running now

```
ps aux | grep -E "uvicorn|agent\.py|node" | grep -v grep; sudo ss -ltnp | grep -E ':(8000|3000|3001|4000)'
```

Note the port uvicorn is listening on. The rest of this assumes **8000**.

## 2. Back up the database, evidence and the current site

```
cd /root/A3-PS013-TC084 && tar czf /root/tracepoint-backup-$(date +%F-%H%M).tar.gz backend/data frontend/dist && ls -lh /root/tracepoint-backup-*.tar.gz
```

## 3. Stop the agent

Nothing should be writing evidence while the backend is swapped.

```
pkill -f "agent.py"; pkill -f "agent.js"; sleep 1; ps aux | grep agent | grep -v grep
```

## 4. Pull

```
cd /root/A3-PS013-TC084 && git status --short && git pull
```

If `git status` shows modified tracked files, stop and look at them first —
`git pull` will refuse or clobber. Untracked files such as
`agent/start_live_agent.sh` are fine and will be left alone.

This deletes `backend/app/*.py` and `agent/agent.py`. The running uvicorn keeps
serving from memory until it is stopped in step 7.

## 5. Install backend dependencies and smoke-test on a spare port

Still with uvicorn running and serving traffic.

```
cd /root/A3-PS013-TC084/backend && npm ci --omit=dev
```

```
cd /root/A3-PS013-TC084/backend && PORT=8099 node src/server.js & sleep 3; curl -sS http://127.0.0.1:8099/health; echo; kill %1
```

Expect `{"status":"ok","service":"tracepoint"}`. If it prints a `node:sqlite`
error, go back to step 0. **If this step fails, stop — the site is still up and
nothing has changed.**

## 6. Build the frontend into a fresh folder, then swap

Never build straight into the live `dist`; a failed build would leave the site
half-replaced.

```
cd /root/A3-PS013-TC084/frontend && npm ci && npx vite build --outDir dist.new --emptyOutDir
```

```
cd /root/A3-PS013-TC084/frontend && mv dist dist.old && mv dist.new dist && ls dist/index.html
```

## 7. Cut over

```
pkill -f uvicorn; sleep 2; cd /root/A3-PS013-TC084/backend && nohup env PORT=8000 node src/server.js > /root/tracepoint-backend.log 2>&1 & sleep 3; curl -sS http://127.0.0.1:8000/health; echo
```

Make sure `GROQ_API_KEY` is exported in that shell, or the AI assistant will
report that the key is not configured.

## 8. Set a new password

Required — the Argon2 hash cannot be verified by this backend. The script reads
the password from stdin, so it does not go into shell history.

```
cd /root/A3-PS013-TC084/backend && node scripts/set-password.mjs aditishukla29700@gmail.com
```

It prints the user id and confirms it is unchanged. Use a password you have not
used before: the old one was written to `~/.bash_history` on a public server.

## 9. Restart the agent, collecting root only

`start_live_agent.sh` lives only on this box and still points at `agent.py`.
Edit it to run `node agent.js` and add the scope line:

```
export TRACEPOINT_USER_FILTER=root
```

Then:

```
cd /root/A3-PS013-TC084/agent && nohup ./start_live_agent.sh > /root/agent.log 2>&1 & sleep 5; head -20 /root/agent.log
```

The startup banner must show:

```
Scope:     username in [root] -- all other lines on this host are NOT collected
```

Check the read offset lines up with the file, so the agent is tailing rather
than replaying:

```
cat /root/A3-PS013-TC084/agent/live-state/agent-state-*.json; stat -c %s /var/log/auth.log
```

## 10. Verify

```
curl -sS https://api.tracepoint.jassist.qzz.io/api/v1/ping
```

A Node backend returns `{"detail":"Not found"}` (lowercase f). FastAPI returned
`{"detail":"Not Found"}`. If you still see the capital F, uvicorn is still up.

Then sign in on the site with the new password, SSH in from another terminal
once with the right password and once with a wrong one, and confirm both show
up in the timeline as a successful and a failed login against `root`.

---

## Rollback

If the cutover goes wrong, the old code is one commit away:

```
pkill -f "node src/server.js"; cd /root/A3-PS013-TC084 && git checkout b45f737 && cd frontend && rm -rf dist && mv dist.old dist
```

Then start uvicorn the way step 1 recorded it, and restore the database from
the step 2 tarball only if something actually wrote to it:

```
cd /root/A3-PS013-TC084 && tar xzf /root/tracepoint-backup-<timestamp>.tar.gz backend/data
```

Returning to Python also restores Argon2 verification, so the original password
works again — but step 8's new password will not. Set it back with the old
backend's own signup/login flow if needed.
