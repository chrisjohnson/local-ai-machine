# Benchmarking SOP

**Purpose.** This is the authoritative, literal procedure for running any benchmark (speed or
coding-capability) on this machine, on any engine (vLLM, llama.cpp direct, Ollama). It exists so
every future run — including the planned full re-run of every already-tested model for
apples-to-apples comparison — follows exactly the same steps, captures exactly the same fields,
and produces genuinely comparable numbers.

This document is **procedural, not narrative**. For the reasoning/history behind these steps, see
`MODEL_STACK_CATALOG.md` (per-combination facts) and `OPTIMIZATIONS.md` / `README.md` Phase 5 (the
session-by-session narrative). Read this file when you're about to run a benchmark; read those
when you need to understand why a step exists.

**Honesty rule.** If a step below hasn't actually been done in a prior run (e.g. warm-up trials,
multiple repeated runs for variance), this doc says so plainly. Do not invent a trial count or
methodology that was never actually used — follow what's written here exactly, or update this file
first if you deliberately change the methodology (and note the change in `OPTIMIZATIONS.md`).

---

## 0. Before you start

- Never run a benchmark concurrently with other work on the box (other tests, harness runs, model
  swaps, downloads). One benchmark at a time, full stop.
- All commands below run on the target machine (`ssh chris@local-ai-machine.local`) unless marked
  "from the Mac."
- Passwordless sudo is configured for `chris` scoped to `nixos-rebuild switch` **and**, as of
  2026-07-24, `systemctl start`/`systemctl stop`/`systemctl restart` (all three verbs, NOPASSWD,
  scoped to those verbs only — not `enable`/`disable`/`edit`/masking). `docker`/`docker compose`
  commands do **not** need `sudo` (chris is in the `docker` group). **Pausing/resuming
  `download-model-*.service` units DOES need `sudo -n systemctl stop/start` in practice** —
  confirmed 2026-07-24: plain `systemctl stop <unit>` fails with "Access denied... requires
  interactive authentication" for these units, `sudo -n systemctl stop <unit>` succeeds cleanly
  and silently (no password prompt). This corrects an earlier (now-stale) version of this note
  that claimed no `sudo` was needed for this step. If a command below fails with a permissions
  error and it's `systemctl start/stop/restart`, add `sudo -n` first before treating it as a real
  problem; for other command types, still stop and check rather than blindly adding `sudo`.

---

## 1. Pre-flight checklist (every run, every engine)

Run these checks before touching anything. Do not skip even if you "just checked five minutes
ago" — state can change between runs.

1. **Check for active downloads:**
   ```
   ps aux | grep -iE "hf download|nix.*download " | grep -v grep
   systemctl list-units "download-model-*" --all --no-legend | grep activating
   ```
   If either command shows activity, there is a live download in progress or queued behind the
   shared flock.

2. **If any download units are "activating," pause all of them in one command:**
   ```
   sudo -n systemctl stop $(systemctl list-units "download-model-*" --all --no-legend | grep activating | awk '{print $2}')
   ```
   **Real gotcha, confirmed 2026-07-24**: `--no-legend` output over a non-interactive SSH session
   still includes the leading bullet character (`●`) as column 1 — `awk '{print $1}'` grabs that
   bullet, not the unit name, and silently no-ops (`systemctl stop` on a bare `●` fails with an
   "Invalid unit name" error per unit, easy to miss in a wall of output). Use `$2` for the actual
   unit name. Also needs `sudo -n` in practice (see the note above this checklist) — plain
   `systemctl stop` fails with a permissions error on these units.
   Confirm they're stopped (`systemctl list-units "download-model-*" --all --no-legend` should show
   no "activating" units) before proceeding. Keep a copy of exactly which units you stopped — you
   must resume the same list at teardown (§3).

3. **Check for other benchmark/harness activity elsewhere** — no concurrent `vllm bench serve`,
   `llama-bench`, `coding_benchmark.py`, or `speed_benchmark_swap.sh` runs already in flight (check
   `ps aux` on the target machine, and confirm nothing else is mid-run from the Mac side too, e.g.
   another terminal/agent already driving `coding_benchmark.py` against the same host).

4. **Stop `vllm-primary`/`vllm-judge` if this benchmark needs the full GPU budget or GPU contention
   would invalidate the numbers.** This applies to:
   - Any llama.cpp-direct or Ollama run where you want a clean, GPU-contention-free measurement
     (TG-sensitive numbers especially — see §2's llama.cpp section for the one documented
     exception, PP-vs-TG sensitivity to background load).
   - Any vLLM swap-in benchmark (`scripts/speed_benchmark_swap.sh` / `swap_model_start.sh` already
     do this for you automatically — do not stop them manually first, the scripts handle it).
   - NOT needed for the six-tier coding harness (`scripts/coding_benchmark.py`) against
     `vllm-primary`/`vllm-judge` themselves, since it's calling the already-running production
     service, not swapping anything in.

   To stop manually (when not using one of the swap scripts, which do this internally):
   ```
   cd ~/local-ai-machine/docker && docker compose stop vllm-primary vllm-judge
   ```

---

## 2. Per-engine procedure

### 2.1 vLLM

Two distinct benchmark types run against this engine: **speed** (`vllm bench serve`) and
**coding-capability** (`scripts/coding_benchmark.py`, run from the Mac).

#### Speed: `vllm bench serve` via `scripts/speed_benchmark_swap.sh`

- **Tool**: `scripts/speed_benchmark_swap.sh` (wraps `vllm bench serve` inside a temporary
  container; handles stopping/restoring `vllm-primary`/`vllm-judge` automatically). For the
  standing primary/judge themselves, the same `vllm bench serve` invocation can be run directly via
  `docker exec` against the already-running container instead of the swap script.
- **Invocation template** (target machine, from any directory — the script `cd`s itself):
  ```
  ./scripts/speed_benchmark_swap.sh <model-dir-name> <served-name> <max-model-len> [extra vllm serve args...]
  ```
  Example:
  ```
  ./scripts/speed_benchmark_swap.sh gemma-4-31b-it gemma-4-31b-it 65536 \
    --enable-auto-tool-choice --tool-call-parser gemma4 --reasoning-parser gemma4
  ```
  For AWQ models requiring extra env vars (e.g. the 122B tier's Triton AWQ kernel path), set
  `SWAP_ENV_VARS` before invoking `swap_model_start.sh`/`swap_model_stop.sh` directly if you need
  more control than the all-in-one swap script gives:
  ```
  SWAP_ENV_VARS="VLLM_USE_TRITON_AWQ=1" ./scripts/swap_model_start.sh <model-dir> <served-name> <max-model-len>
  ```
- **Concurrency levels tested**: **c1** (concurrency 1, single-stream) and **c8** (concurrency 8).
  This is the full matrix used to date — no other concurrency levels have been benchmarked in this
  project. Dataset: `random`, `--ignore-eos`, `--random-input-len 2048`. c1 uses
  `--random-output-len 512` with `--num-prompts 20`; c8 uses `--random-output-len 256` with
  `--num-prompts 100`.
- **Warm-up / trial-count convention: none.** Every existing number in this project is a **single
  run per concurrency level**, not an average of repeated trials, and no explicit warm-up request
  precedes the timed run. Be honest about this in any new results — if you want statistical
  confidence via repeated runs, that's a real methodology change, not the established convention;
  note it explicitly in the results file and the catalog entry if you do it.
- **Fields to capture** (all present in the tool's own JSON output, saved automatically by the
  swap script to `~/bench-results/<served-name>-c<N>.json` on the target machine — copy these back
  into this repo's `results/` per §4):
  - Output throughput (tok/s)
  - TTFT: mean, median, p99 (ms)
  - TPOT: mean, median, p99 (ms)
  - Model footprint if available in server logs/startup output: weights size, KV cache size, max
    KV tokens, max concurrency multiplier at the configured `--max-model-len`
- **Known tool quirk**: `vllm bench serve` segfaults on client-side exit right after a c8 run
  completes. This is harmless — the server keeps running and the result JSON is already saved
  before the crash. Scripts must tolerate the nonzero exit code (`|| true`) and verify success by
  checking the result file exists, not by trusting the exit code. Already implemented this way in
  `speed_benchmark_swap.sh`.

#### Coding-capability: six-tier harness (`scripts/coding_benchmark.py`)

- **Tool**: `scripts/coding_benchmark.py`, run from the **Mac** (not the target — the target's
  NixOS host has minimal Python tooling) against the model's OpenAI-compatible vLLM endpoint.
- **Invocation template**:
  ```
  python3 scripts/coding_benchmark.py --base-url http://local-ai-machine.local:<port> \
      --model <served-model-name> --output results/<model-slug>.json
  ```
  Use port `8000` for whatever is currently swapped into the primary slot, `8001` for the judge
  slot, or the swap container's exposed port (also `8000` via loopback — only one can be up at a
  time when using the swap scripts).
- **No separate warm-up run** — the harness runs each tier's tasks once, cold, against the
  endpoint. If the model was just swapped in, wait for `/health` to return healthy first (the swap
  scripts already block on this).
- **Six tiers, stdlib-only, no LLM-judge scoring** (objective grading only):
  - **Tier A** — correctness: generated code executed against real test assertions in a sandboxed
    subprocess. 3 tasks (`palindrome`, `merge_sorted`, `expr_eval`).
  - **Tier B** — tool-calling: real tool schema sent, response's `tool_calls` checked structurally.
    2 tasks (`single_tool_call`, `multi_step_tool_call`).
  - **Tier J** — judge-role fitness: rubric + code sample (one correct, one subtly buggy), strict
    JSON verdict required. 2 tasks (`judge_correct`, `judge_incorrect`).
  - **Tier P** — personal-assistant fitness: constrained-length summary + structured-data
    extraction, graded objectively. 2 tasks (`constrained_summary`, `structured_extraction`).
  - **Tier D** — multi-turn interactive debugging: a real 3-turn conversation, final turn's code
    executed against test assertions. 1 task (`debug_off_by_one`).
  - **Tier Q** — planning/requirements-gathering: underspecified brief, checked via keyword
    matching against a minimum number of missing-dimension topics. 2 tasks
    (`planning_new_tool`, `planning_db_migration`).
- **All six tiers run against every model by default**, even models only being considered for the
  coding role — this way judge/assistant-role data is already on hand without a special-cased
  re-run later.
- **Output format**: single JSON file with a top-level summary (`model`, `base_url`,
  `tier_<X>_pass` / `tier_<X>_total` for each of A/B/J/P/D/Q) plus a `results` array with one
  object per task (`id`, `tier`, `elapsed_s`, `passed`, plus tier-specific fields like
  `raw_content`, `raw_reasoning`, `extracted_code`, `called_tool`, `called_args`, `verdict`,
  `topics_hit`, `error`). See any existing `results/<model-slug>.json` for the exact shape (e.g.
  `results/qwen3.6-27b.json`, `results/glm-4.7-flash-awq.json` for a full six-tier example vs. the
  older four-tier-only files).
- **Note**: some earlier catalog entries only ran Tier A+B (the harness originally had fewer
  tiers) — going forward, run all six every time for genuine comparability. If a re-run of an
  older model only has A+B data, that's a real gap versus the current six-tier convention, not
  something to paper over — flag it in the catalog entry.
- **Timeout**: 1500s (25 min) per request — sized for the slowest model tested (122B tier at
  ~7.5-8 tok/s needing ~18 min for an 8192-token response). Don't reduce this for faster models
  "to save time" — it only matters when a model is genuinely slow, and a premature timeout would
  silently corrupt results as false failures.

---

### 2.2 llama.cpp direct (`kyuz0/amd-strix-halo-toolboxes:vulkan-radv`)

- **Tool**: `llama-bench` inside the toolbox container, run directly via `docker run` (no
  standing service, no compose entry — this engine is invoked ad hoc per benchmark).
- **Invocation template**:
  ```
  docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
    -v /var/lib/ai-models/<model-dir>:/models:ro \
    kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
    llama-bench -m /models/<gguf-filename> -ngl 999 -fa 1 -lm none
  ```
  - `-ngl 999`: offload all layers.
  - `-fa 1`: flash attention on.
  - `-lm none`: **not** the deprecated `--no-mmap` (that flag errors on this build with "invalid
    parameter for argument") — `-lm none` / `--load-mode none` is this build's equivalent.
  - `--group-add 26 --group-add 303`: numeric GIDs for `video`/`render` (confirmed via
    `getent group video render` on this host) — this image resolves group names fine too, but the
    documented working invocations use numeric GIDs, so match that for consistency.
- **Warm-up / trial-count convention: none.** Every existing number is a **single `llama-bench`
  invocation** (which itself reports mean ± stddev across its own internal repeated passes for
  pp512/tg128 — that internal variance is the tool's own behavior, not a project-level repeated-run
  convention layered on top). No separate project-level warm-up run precedes it.
- **Fields to capture**: `pp512` (prompt processing, tok/s ± stddev) and `tg128` (token
  generation, tok/s ± stddev), plus the model size/param-count line the tool prints
  (`size`, `params`) and the build hash (`build: <hash> (<number>)`) at the bottom of stdout.
- **GPU-contention sensitivity — real, measured, asymmetric**: prompt processing (pp512) is
  measurably sensitive to concurrent background load (a concurrent `hf download` cost ~4.9%
  throughput in one directly-measured case); token generation (tg128) was statistically
  unaffected by the same concurrent download (within run-to-run noise). **Practical rule: always
  pause the download queue (§1) before a PP-sensitive run; TG-only comparisons are more robust to
  it but pause the queue anyway for full apples-to-apples cleanliness across the whole project.**
  Always stop `vllm-primary`/`vllm-judge` too, regardless — every clean benchmark-of-record number
  in this project was taken with both GPU-contention sources removed.
- **MTP speculative decoding**: real and working on this toolbox build (`--spec-type draft-mtp
  --spec-draft-n-max 3`, via `llama-cli`/`llama-server`, **not** `llama-bench` — `llama-bench` has
  zero spec/draft/mtp flags). Only attempt this if the specific GGUF file is confirmed to ship MTP
  head tensors (check the HF repo's file listing for MTP-tagged variants, e.g.
  `unsloth/<model>-MTP-GGUF` as a **separate** repo from the plain quant) — plain quants already on
  this box have repeatedly failed to load with `context type MTP requested but model doesn't
  contain MTP layers`. Do not assume a plain-quant GGUF has an MTP head without checking.

---

### 2.3 Ollama

- **Tool**: `scripts/ollama_register_model.sh` to register a GGUF, then a single timed
  `/api/generate` request via `curl`.
- **Standing image/config** (already proven, do not deviate without a new investigation):
  `ollama/ollama:0.17.7` (plain tag, **not** `-rocm` — that tag crashes on real inference despite
  passing GPU detection) with all three of:
  ```
  OLLAMA_VULKAN=1
  HIP_VISIBLE_DEVICES=-1
  ROCR_VISIBLE_DEVICES=-1
  ```
  `group_add` must use numeric GIDs (`["26", "303"]`) — Ollama's own `/etc/group` doesn't define
  `video`/`render` names, unlike the vLLM/llama.cpp toolbox images.
- **Registration**:
  ```
  ./scripts/ollama_register_model.sh <model-dir-name> <gguf-filename> <ollama-model-name>
  ```
  This is idempotent-ish (re-running `ollama create` on an existing name just recreates it) and
  requires the model's `.download-complete` marker to already exist.
- **Benchmark request**:
  ```
  curl -sS localhost:11434/api/generate -d '{"model":"<ollama-model-name>","prompt":"<prompt>","stream":false}'
  ```
- **Warm-up / trial-count convention: none, and a real caveat.** Every existing Ollama number in
  this project is a **single `/api/generate` request**, and in every case so far it was also the
  **first request after `ollama create`** — meaning `total_duration` includes model load time
  (`load_duration`), and the response includes a full `<think>` reasoning trace that inflates
  `eval_count`. This is explicitly **not** an averaged `llama-bench`-style run — treat any derived
  tok/s figure as directionally comparable, not a precise controlled measurement, and say so in the
  results file. If you want a cleaner number, issue a second (warm) request and prefer its
  `eval_count`/`eval_duration` instead — but note explicitly in the results file if you do this,
  since it changes the convention used everywhere else in the project so far.
- **Fields to capture** (from the raw JSON response): `eval_count`, `eval_duration` (ns),
  `prompt_eval_count`, `prompt_eval_duration` (ns), `load_duration`, `total_duration`, and the
  full raw response text (contains the reasoning trace, useful for debugging).
- **Derivation**: `tok/s = eval_count / (eval_duration / 1e9)`. Do the same for prompt-eval if
  useful, but note when the prompt is trivially short (not a meaningful PP measurement).
- **Known architecture blocker, check before benchmarking**: this Ollama build's bundled
  ggml/llama.cpp does not recognize newer GGUF architecture tags (confirmed: `gemma4` fails
  outright with `unknown model architecture: 'gemma4'`, a hard blocker, not a speed issue).
  Qwen3-family architectures are confirmed supported. If registration succeeds but the first real
  generate request fails with an `unknown model architecture` error, that's a genuine, documented
  version-tradeoff limitation of 0.17.7 — record it as BROKEN in the catalog, don't treat it as a
  benchmark failure to retry.
- **GPU contention**: same rule as llama.cpp — stop `vllm-primary`/`vllm-judge` and pause the
  download queue (§1) before running, for a clean number.

---

## 3. Post-flight / teardown checklist

**Sequencing is mandatory and safety-critical.** A real incident already happened from getting
this wrong: restarting `vllm-primary`/`vllm-judge` **concurrently** with resuming the download
queue overloaded host memory (`free -h` showed ~92GiB used / only ~2-7GiB free against a 124GiB
pool while a 66.97GiB model checkpoint was mid-load) and SIGKILLed both vLLM engine-core processes
(OOM-killer). **vLLM must restart first and be confirmed healthy BEFORE downloads resume — never
simultaneously.**

1. **Restart vLLM first** (if it was stopped for this benchmark, or if a swap-in benchmark's
   teardown didn't already do this — the swap scripts do this automatically):
   ```
   cd ~/local-ai-machine/docker && docker compose up -d vllm-primary vllm-judge
   ```
   (Or, if a swap script/`swap_model_stop.sh` was used, this already ran as part of teardown.)

2. **Confirm both are healthy before touching anything else:**
   ```
   curl -sf http://localhost:8000/health
   curl -sf http://localhost:8001/health
   ```
   Both must return healthy (HTTP 200 / empty success body) before proceeding to step 3. If either
   is not yet healthy, wait and re-check — do not resume downloads while waiting.

3. **Only then resume the download queue**, using the exact same list of units that were paused
   in §1 (needs `sudo -n`, same as the pause step):
   ```
   sudo -n systemctl start <unit1> <unit2> ...
   ```
   Expect an "activating" unit or two to report `Job for download-model-X.service failed because
   the control process exited with error code` right after resuming — this is normal, not a new
   failure introduced by the pause/resume cycle. It means that unit is back to its own pre-existing
   retry-loop behavior (e.g., waiting behind the shared flock while another download is in
   progress), the same "activating" state it was in before it got paused. Confirm via the unit
   count, not the absence of any error text:
   Confirm they went back to "activating":
   ```
   systemctl list-units "download-model-*" --all --no-legend | grep activating
   ```

4. **Confirm no benchmark artifacts (temp containers, volumes) were left behind**: e.g.
   `docker ps -a | grep vllm-bench-swap` should show nothing (the swap scripts clean this up
   automatically, but verify after any manual/ad hoc run).

---

## 4. Recording convention

- **Raw output**: save to `results/<model-slug>--<engine>[-config-tag].{txt,json}`.
  - `<model-slug>`: lowercase, matches the model's catalog entry naming (e.g.
    `gemma-4-26b-a4b-it`, `qwen3.6-35b-a3b`).
  - `<engine>`: `llamacpp`, `ollama`, or `vllm`.
  - `[-config-tag]`: optional, for variant runs against the same model+engine (e.g.
    `--llamacpp-mtp` for an MTP speculative-decoding attempt vs. the plain-decode baseline).
  - Extension: `.txt` for raw stdout/text captures (llama.cpp, Ollama), `.json` for native JSON
    tool output (vLLM's `vllm bench serve` result files, `coding_benchmark.py`'s output).
  - The double-dash `--engine` suffix is required for all new speed-benchmark artifacts — do not
    collide with the older bare `<model-slug>.json` coding-harness files already in `results/`
    (produced before this convention existed; leave those as-is, do not rename them).
  - **This is a hard requirement, not optional.** Narrative-only numbers pasted into a catalog
    entry, `README.md`, or `OPTIMIZATIONS.md` are not an acceptable sole record — save the actual
    file every time.
  - A `.txt` results file should include, at minimum: the exact command run (with real paths/
    flags, not paraphrased), the date, any notes on GPU-contention/download-pause state during the
    run, and the full raw stdout/response. See `results/qwen3.6-27b--llamacpp.txt` and
    `results/qwen3.6-27b--ollama.txt` for the exact expected shape.

- **Catalog entry**: add or update an entry in `MODEL_STACK_CATALOG.md` under the correct engine
  section, using the template at the top of that file's "House rules for future entries" section.
  Every entry must include a `**Results file**` field pointing to the relative path(s) saved above
  — never "not preserved as a file" for any new run going forward.

- **Narrative note**: add a brief addition to `OPTIMIZATIONS.md` and/or `README.md`'s Phase 5
  section — a short paragraph documenting what was run, the headline numbers, and anything
  noteworthy (contention, gotchas, comparisons to prior results). This is a small addition to the
  existing running log, **not** a rewrite of either file.

---

## 5. What "done" looks like for a benchmark task

A benchmark task is complete only when **all** of the following are true:

1. Raw results file(s) saved under `results/` per the naming convention in §4.
2. `MODEL_STACK_CATALOG.md` entry added or updated with the `**Results file**` field pointing to
   the saved file(s).
3. A brief narrative note added to `OPTIMIZATIONS.md` and/or `README.md`'s Phase 5 section.
4. All of the above committed and the commit pushed.
5. Standing services restored to their prior running state, in the correct order (§3):
   `vllm-primary`/`vllm-judge` confirmed healthy via `/health` on both ports, **then** the download
   queue resumed and confirmed back to "activating" for whichever units were paused.
6. No leftover temporary containers/volumes from the benchmark run (swap containers, swap cache
   volumes).

If any of these are missing, the benchmark is not done — a results file with no catalog entry, or
a catalog entry with no committed results file, or services left down/paused, all count as
incomplete work.
