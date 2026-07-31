---
name: adding-tools-to-pi-web
description: Use when a shell command, CLI tool, or pi extension you need isn't available in this environment (command not found, missing npm package, etc.) and needs to be added to pi-web itself.
---

# Adding a new tool to pi-web

You're running inside the `pi-web` container. If you hit a missing binary
(`ssh`, `gh`, `jq`, `ffmpeg`, anything not already installed) or want a new
pi extension (npm package), here's the actual process — the same one used
to add `openssh-client`/`gh` to this container (see fleet card M-044 in
`.fleet/board/done/` for the full story, including three real bugs that
each looked like the whole fix until tested).

You have full git/SSH push access to this repo already (`/home/chris/local-ai-machine`,
same GitHub deploy key this container itself authenticates with) and can
do steps 1–3 yourself. Step 4 needs a human or a session with Docker
access — you can't rebuild/restart your own container from inside it.

## 1. Figure out which kind of addition this is

- **System binary** (a CLI tool, library, anything installed via `apt`) →
  edit `pi-web/Dockerfile`'s `apt-get install` list. If it's not packaged
  for Debian, see the `gh` CLI block in that same file for the
  release-tarball-install pattern.
- **pi extension** (an npm package that adds tools/providers to pi itself)
  → edit `pi-web/docker-entrypoint.sh`. Copy the existing `pi-claude-bridge`
  or `@juicesharp/rpiv-web-tools` block exactly — version-pinned
  `npm install --prefix "$PI_CODING_AGENT_DIR/npm"`, skip if already at
  that version, register in `settings.json`'s `packages` array. Don't
  invent a new pattern.

## 2. Make the edit and commit it

```
cd /home/chris/local-ai-machine
# edit pi-web/Dockerfile or pi-web/docker-entrypoint.sh
git add pi-web/Dockerfile   # or docker-entrypoint.sh
git commit -m "pi-web: add <tool> for <reason>"
git push origin main
```

This repo pushes directly to `main` — no branch/PR needed here (confirmed
project convention, distinct from the fleet-wide default elsewhere).

## 3. Tell the human exactly what to run

You cannot rebuild or restart your own container — no `docker` CLI or
`docker.sock` access inside `pi-web` (deliberately not granted; see
M-044's decision log). Print this back to whoever you're talking to,
verbatim, so they can run it (from their Mac, or by asking a Claude Code
session with box access):

```
ssh local-ai-machine "cd /home/chris/local-ai-machine && git pull --ff-only && \
  cd docker && docker compose build pi-web && docker compose up -d pi-web"
```

Scoped to `pi-web` only — never suggest an unscoped `docker compose up -d`,
it will restart every model on the box.

## 4. What happens to this conversation

Your session history lives in the `pi-web-data` volume, not the
container — a rebuild/restart does not lose it. The human reopens the same
session URL (`?session=<same-uuid>`) afterward and you're both back where
you left off, tool now available.

## 5. Verify before declaring it done

Don't trust "container started" or even "binary is present" as proof —
test the actual thing you needed. M-044's own history: the container came
back up fine, `ssh` was later confirmed present, and it *still* didn't
work for a third, unrelated reason (OpenSSH resolving the home directory
from `/etc/passwd`, not `$HOME`). Run the real command you originally
needed and confirm real output before telling the human it's fixed.
