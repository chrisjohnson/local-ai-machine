---
id: 2026-07-22-open-webui-added
date: 2026-07-22
source: "README.md (Decision Log — 2026-07-22, \"New service: Open WebUI\")"
tags: [open-webui, litellm, service]
status: active
---

# Add Open WebUI as the first browser-based chat interface

**Decided**: add Open WebUI to the stack as the first browser-based chat interface,
pointed at LiteLLM's unified endpoint rather than any vLLM server directly.

**Why**: gives a human-usable chat UI without exposing raw vLLM ports or bypassing the
authenticated gateway. Routing through LiteLLM keeps the same auth/routing story as every
other client of this stack.

**Alternatives considered**: none recorded — this was a straightforward addition, not a
comparison among UI options.

**Operational note**: uses first-signup-becomes-admin (`WEBUI_AUTH=true`), deliberately
left for the human to do manually rather than automated, since it's their own login.
