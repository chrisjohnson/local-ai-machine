# Adding new tools to pi-web

How to give pi (running in `pi-web`) a new capability — a system binary
(like `ssh`, `gh`, `jq`, `ffmpeg`) or a new pi extension (an npm package,
like `pi-claude-bridge` or `@juicesharp/rpiv-web-tools`) — and how to get
back to where you were afterward.

## Your sessions survive a rebuild/restart

`pi-web`'s session history lives in `/data/pi-agent-config/sessions`,
inside the `pi-web-data` named Docker volume — not inside the container
itself. Rebuilding the image and recreating the container (`docker compose
up -d pi-web`) does not touch that volume. After a redeploy, reopen the
same session URL you were using
(`http://<box>:30141/?session=<the-same-uuid>`) and the conversation is
still there. This was exercised for real three times in a row during
M-044's work (rebuild → redeploy → reconnect) without losing anything.

## The two kinds of "new tool," and the process for each

Both end up touching `pi-web/Dockerfile` (system binaries) or
`pi-web/docker-entrypoint.sh` (pi extensions) — either way, that means a
real image rebuild, not a hot-reload. There's no way around that today
(see "What full self-service would need," below).

### A system binary (e.g. a new CLI tool)

1. Add it to the `apt-get install` list in `pi-web/Dockerfile` (or, if it's
   not packaged for Debian, a manual install step — see the `gh` CLI block
   in that file for the pattern: fetch a release tarball, extract, move
   the binary into `/usr/local/bin`).
2. Commit + push from the Mac (`git add pi-web/Dockerfile && git commit &&
   git push origin main`).
3. On the box: `ssh local-ai-machine "cd /home/chris/local-ai-machine &&
   git pull --ff-only"`.
4. Rebuild and redeploy, **scoped to just this service** — never an
   unscoped `docker compose up -d`:
   ```
   ssh local-ai-machine "cd /home/chris/local-ai-machine/docker && \
     docker compose build pi-web && docker compose up -d pi-web"
   ```
5. Verify the actual capability works, not just that the container
   started — `docker exec pi-web <the new binary> --version` at minimum;
   for anything credential-dependent (like M-044's `ssh`/`gh` fixes),
   exercise the real path (`ssh -T git@github.com`, not just `which ssh`).
   M-044 is a good cautionary example: the container looking "up" and
   even the binary being present were both insufficient signals on their
   own — three separate real bugs (uid/HOME mismatch, missing binaries,
   OpenSSH ignoring `$HOME`) each looked like the whole fix until tested.

### A pi extension (npm package)

Same rebuild/redeploy mechanics as above, but the change goes in
`pi-web/docker-entrypoint.sh` instead of the Dockerfile — follow the exact
idempotent pattern already there for `pi-claude-bridge` and
`@juicesharp/rpiv-web-tools`: version-pinned `npm install --prefix
"$PI_CODING_AGENT_DIR/npm"`, skipped if the installed version already
matches, plus registering the package in `settings.json`'s `packages`
array if it isn't already there. Don't invent a new pattern per package —
copy one of the two existing blocks and change the package name/version.

## What full self-service (pi rebuilding/relaunching its own container) would need

Chris asked whether pi itself could eventually do this loop unattended —
edit its own Dockerfile, rebuild, and relaunch its own container. It's
possible in principle, but requires a real capability grant that doesn't
exist today and shouldn't be added silently:

- **Docker CLI + `/var/run/docker.sock` mounted into `pi-web`** — neither
  is present in the image/compose config right now. `turnstone` already
  has both, and the compose file's own comment on that grant says it
  plainly: "a real privilege-escalation vector, not just a config tweak —
  anything that can run `docker run --privileged -v /:/host ...` through
  this socket can trivially root the host. Accepted deliberately, not a
  default." The same tradeoff would apply here, on a service with no
  authentication in front of it (`PI_WEB_PASSWORD` unset, LAN-only by
  policy).
- **`docker` CLI binary** in the image (apt package `docker-cli` +
  `docker.io`, matching turnstone's own Dockerfile) — not installed in
  pi-web today.
- A way to target the compose file from inside the container (it would
  need `/home/chris/local-ai-machine` on its own filesystem view, which
  it already has via the whole-home-dir mount — so this part is free).

None of this is wired in. If you want it, that's a deliberate decision to
make explicitly (same class of call as granting `docker.sock` to
turnstone was) — not something to bolt on as a side effect of a tools
ticket. Worth its own card if/when you decide you want it.
