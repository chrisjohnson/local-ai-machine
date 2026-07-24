qwen3.6-27b tok/sec on strix halo 128gb

On an AMD Strix Halo system with 128GB of unified LPDDR5X memory (~215 GB/s bandwidth), the token generation (TG) speed for Qwen3.6-27B varies dramatically between 4 and 101+ tokens per second (tok/sec) depending on your quantization level, backend software, and use of Multi-Token Prediction (MTP). Because Strix Halo is heavily system-memory bandwidth bound, optimization is critical.Performance Breakdown by SetupFull Precision (BF16 Unquantized): Expect 3.9 to 4.2 tok/sec. Running the model without quantization fits comfortably in the 128GB pool but entirely bottlenecks the memory bus.Standard GGUF Quants (No MTP):Q6_K: Expect ~8.7 tok/sec.Q4_K_M: Expect ~12 to 15 tok/sec.Optimized GGUF/EXL2 with MTP Enabled: Expect 25 to 50 tok/sec. Enabling MTP (Multi-Token Prediction) speculative decoding under modern llama.cpp or vLLM setups provides a 2x to 2.44x acceleration boost. During continuous multi-turn coding agent tasks, token generation frequently spikes into the 35–50 tok/sec range as context fills.Custom RDNA3 Kernels & Aggressive Quants: Up to 101 to 134+ tok/sec. Using heavily optimized, hardware-specific setups like the custom ROCmFP4/FP6 tensor types (e.g., Chadrockv2 Profiles or specialized hipEngine/Vulkan backends) with sub-4-bit weights drops the memory footprint drastically, shifting the bottleneck away from the bus.Performance Optimization ChecklistIf your generation speeds are sitting at the lower end of these metrics, ensure your environment is explicitly tuned for the Strix Halo silicon:Set GFX Version Override: Upstream ROCm stacks require HSA_OVERRIDE_GFX_VERSION=11.5.1 to correctly target and register the iGPU.Disable SDMA: Execute with HSA_ENABLE_SDMA=0 to prevent unpredictable system hangs and thread lockups during heavy generation workloads.Max the Heap: Set GPU_MAX_HEAP_SIZE=100 to guarantee the runtime allocates the maximum possible shared heap from your 128GB pool.Limit Draft Max: When configuring MTP speculative drafting, keep your --spec-draft-n-max setting locked between 2 and 3. Pushing it to 4 or higher heavily degrades execution performance on this specific architecture.If you are setting this up right now, let me know which backend runner (e.g., llama.cpp, vLLM, Ollama) and what OS you are targeting so I can give you the exact command flags to hit maximum speeds.14 sitesWhat speed is everyone getting on Qwen3.6 27b? - RedditApr 22, 2026 — Comments Section ... RTX 5090 running UD_Q5_K_XL - ~45tok/s TG at token 1000, more like 35 at token 100000. PP is reporting at ~20...Reddit·r/LocalLLaMAQwen 3.6 27B on Strix Halo 128GB: any experiences? - RedditApr 27, 2026 — You don't even need a draft model, but the use case is mainly for coding. Sixstringsickness. •. 3mo ago. n gram offered little to ...Reddit·r/LocalLLaMAQwen3.6 27B at 2.44× on a Strix Halo, 2.17× on a RTX 3090 rigMay 18, 2026 — Qwen3. 6 35B-A3B (MoE): Strix Halo: 49.5 → 69.4 tok/s (1.40×) 3090: 120.0 → 148.3 tok/s (1.24×)Reddit·r/LocalLLaMAShow allvllmRunning vLLM on a 128GB AMD Strix Halo system targeting Qwen3.6-27B requires precise configuration because consumer iGPUs are not yet completely plug-and-play in mainstream upstream branches.The primary architecture goal is maximizing token throughput while stabilizing the RDNA 3.5 layout (gfx1151).Optimized vLLM Performance Expectations (Qwen3.6-27B)BF16 Unquantized: Expect 3.9 to 4.2 tokens/sec. While it completely fits within the 128GB unified memory pool, it severely bottlenecks the 215 GB/s LPDDR5X bus.AWQ Int4 Quantization: Expect 14 to 18 tokens/sec. Note that native FP8 execution frequently fails or exhibits instability on Strix Halo, making AWQ 4-bit/8-bit weights the mandatory path for compressed execution under vLLM.Prerequisites & Stability RulesBefore launching the server, you must account for hardware-register bugs specific to gfx1151:Linux Kernel: You must run Linux Kernel 6.18.4 or newer. Older kernels will trigger sudden GPU resets under dense load due to mismatched register limit definitions.ROCm Version: Pair the kernel with ROCm 7.2 or newer to resolve critical VGPR (Vector General Purpose Register) resource allocation crashes.The Environment Stack: If PyPI wheels fail to detect the card, developers leverage pre-configured kyuz0 Strix-Halo Toolboxes via Podman/Docker or execute a source compilation utilizing the VLLM_TARGET_DEVICE=rocm flag.The Launch CommandWhen executing the OpenAI-compatible API server via vLLM, use the following structural template, substituting your local path to the model:bash# 1. Inject the mandatory Strix Halo hardware overrides
export HSA_OVERRIDE_GFX_VERSION=11.5.1
export HSA_ENABLE_SDMA=0
export GPU_MAX_HEAP_SIZE=100

# 2. Fire up the vLLM server
vllm serve /path/to/Qwen3.6-27B-AWQ \
    --port 8000 \
    --quantization awq \
    --vllm-attention-backend triton \
    --gpu-memory-utilization 0.90 \
    --max-model-len 32768 \
    --trust-remote-code
Use code with caution.Critical Flags Decoded--vllm-attention-backend triton: Mandatory optimization. While the rocm backend utilizing AMD's CK kernels is occasionally tested, it behaves unpredictably and triggers load failures on Strix Halo. The Triton runtime compiler backend serves as the most stable baseline.--quantization awq: Required if you want to push generation past 15+ tokens/sec. Avoid FP8 flags as they are currently non-functional on this architecture tier.--gpu-memory-utilization 0.90: Tells vLLM to map up to 90% of your designated allocation for weights and KV Cache management. Because Strix Halo uses Unified Memory Architecture (UMA), leave 10% overhead for your system operating environment and background OS layers.Are you running this inside a Docker container/Toolbx environment, or are you working directly with a native bare-metal Python environment? If you encounter specific kernel compilation or driver errors, let me know.


how about 35b-a3b, any optimizations there?

The Qwen3.6-35B-A3B model is a massive upgrade for Strix Halo architectures. Because it is a sparse Mixture of Experts (MoE) with a hybrid attention design, it packs 35 billion total parameters for broad world knowledge but activates only 3 billion parameters per token.For a memory-bandwidth-bound system like Strix Halo, this is a major architectural advantage: you get the intelligence of a dense ~30B model with the low math overhead of a 3B model. Under standard configurations, expect ~25 to 45 tokens per second, with optimized RDNA3 custom kernels pushing decode benchmarks past 100+ tokens per second.Serving this architecture in vLLM inside your Docker Compose setup introduces unique challenges and opportunities.Crucial Architectural OptimizationsThe 35B-A3B model relies on a unique hidden layout alternating between Gated DeltaNet (linear attention) and standard Gated Attention blocks. To prevent severe context slowdowns and memory thrashing, your container environment must adjust how it caches and maps computation:Leverage Sparse Expert Routing: By utilizing Triton, vLLM routes to exactly 8 active experts out of 256 per token. This requires high shared-memory (shm_size) ceilings in Docker to coordinate the tensor switches seamlessly without CPU handshakes.Aggressive Layer-Wise KV Cache Efficiency: Because the model replaces standard full attention with Gated DeltaNet in 3 out of every 4 blocks, its KV cache footprints drop by roughly 75% compared to dense equivalents. You can utilize an aggressive token context length (e.g., 64,000+ tokens) without triggering out-of-memory errors on your 128GB system.Enforce Int4 AWQ Quantization: Running this unquantized (BF16) requires ~70GB for the weights alone, starving the system of context memory room. Quantizing to AWQ Int4 compresses the base footprint to ~18-20GB, giving you enough remaining headroom to allocate huge context pools.Updated Docker Compose for Qwen3.6-35B-A3BModify your existing docker-compose.yml to incorporate MoE-specific runtime parameters:yamlversion: '3.8'

services:
  vllm-strix-moe:
    image: vllm/vllm-openai:latest # Ensure ROCm 7.2+ target image
    container_name: vllm-strix-halo-35b
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - HSA_OVERRIDE_GFX_VERSION=11.5.1
      - HSA_ENABLE_SDMA=0
      - GPU_MAX_HEAP_SIZE=100
      - PYTHONUNBUFFERED=1
      - VLLM_ATTENTION_BACKEND=triton
    devices:
      - /dev/kfd:/dev/kfd
      - /dev/dri:/dev/dri
    volumes:
      - ~/.cache/huggingface:/root/.cache/huggingface
    command: >
      vllm serve Qwen/Qwen3.6-35B-A3B-Instruct-AWQ
      --port 8000
      --host 0.0.0.0
      --quantization awq
      --gpu-memory-utilization 0.85
      --max-model-len 65536
      --max-num-batched-tokens 32768
      --trust-remote-code
    ipc: host
    shm_size: '24gb' # Bumped from 16GB to optimize MoE inter-process expert routing
Use code with caution.Explaining the 35B Custom Flags--max-model-len 65536: You can comfortably push past the standard 32k window. Gated DeltaNet uses fixed-size sequence state compression, meaning your Strix Halo memory bus won't choke under massive token contexts.--max-num-batched-tokens 32768: Restricts the chunk size for prefilling. MoE models can cause spikey VRAM allocation behavior under sudden multi-user or dense systemic queries; keeping this value balanced prevents hardware OOM resets.shm_size: '24gb': Raised from 16GB. Because 8 experts are dynamically selected out of 256 per token, the kernel demands higher instant shared memory allocation pools to serialize the mathematical weights on the RDNA3 compute engine.Would you like help setting up a script to benchmark the exact tokens/sec throughput difference between your 27B model and this MoE 35B model under this config?


Also, details about hybrid models here utilizing NPU + iGPU:
https://www.reddit.com/r/LocalLLaMA/comments/1uegdu0/big_news_for_amd_strix_halo_owners/

## NPU+iGPU Hybrid Inference — r/LocalLLaMA thread (2026-07-23)

Source: https://www.reddit.com/r/LocalLLaMA/comments/1uegdu0/big_news_for_amd_strix_halo_owners/

**Retrieval note:** All automated fetch paths (direct WebFetch on `www.reddit.com`/`old.reddit.com`, the `.json` API on three reddit domains, and three reddit-mirror front ends) were blocked with HTTP 403. The user supplied the actual post text directly (pasted by hand, confirmed by OP as written without LLM assistance), which is what the summary below is based on. Only the OP's post was available — no comments/replies were retrieved, so any disagreement or correction from commenters is unknown and not reflected here.

### What the thread (OP post) actually says

- **OP owns an AMD Ryzen AI Max+ 395 ("Strix Halo")** and states they have relied solely on GGUF models via Vulkan for about a year, while AMD's ROCm software has been catching up to the hardware.
- **OP's core claim: "THE NPU IS USABLE"** — i.e., their headline news is that the XDNA NPU on Strix Halo can now actually be put to work, which OP frames as new/recent (their framing, not independently verified here).
- OP links the **kyuz0 AMD Strix Halo toolboxes database** (`https://kyuz0.github.io/amd-strix-halo-toolboxes/` — the same `kyuz0` project family behind this machine's current vLLM image) and says it "did NOT look so ROCm friendly 6 months ago," implying that page has been tracking/improving ROCm support for gfx1151 over time.
- **"Hybrid Mode" claim**: OP says devices with both an NPU and iGPU (like Strix Halo) benefit from "hybrid models" that use both — describing the NPU as "CRAZY FAST at Prompt Processing" and able to "run parallel to gpu firing" (i.e., NPU handles prefill/prompt-processing while the iGPU handles generation, running concurrently). This is OP's characterization; no benchmark numbers were given to substantiate the "crazy fast" claim.
- OP distinguishes two modes: **NPU-only models** (built specifically for the NPU — OP points to "FastFlowLM NPU" models as an example) vs. **Hybrid mode**, which OP says is the one that actually uses both pieces of hardware together and is the point of the post.
- **Tool named: Lemonade** (lemonade-server.ai) — OP credits the Lemonade project/team ("focus primarily on Ryzen AI and working directly w/ AMD") with making hybrid mode work on their machine "in ways it couldn't a year ago." OP explicitly describes Lemonade's GUI as "ultra bare-bones" and says they "wouldn't recommend it for any actual agentic/chat/harness usage" — it's positioned as a sanity-test/proof-of-concept tool, not a production serving stack.
- OP links AMD's own docs on Hybrid Mode and building hybrid models: `https://ryzenai.docs.amd.com/en/latest/llm/overview.html`.
- **OP's wishlist, not a claim of existing support**: OP explicitly says they want ("wishlist/request") MTP-supported (Multi-Token Prediction) hybrid models — noting Qwen 3.6 has MTP speedup tech from Unsloth, and that AMD has a guide for adapting to "new processor shapes" since a 3.6 GGUF apparently "can't simply be converted to ONNX." OP links AMD's op-prepare guide: `https://ryzenai.docs.amd.com/en/latest/oga_op_prepare.html`. **This means MTP + hybrid-mode is not something OP has done or verified working — it's a request for the community to attempt, with a note to publish results to HuggingFace if anyone does.**

### Relevant/actionable for this machine (gfx1151, kyuz0 vLLM toolbox, 128GB unified memory)

- **Lemonade Server** (lemonade-server.ai) is the concrete, named tool to investigate for NPU+iGPU hybrid execution on this exact chip family. OP's own assessment is that it's good for a quick sanity test of whether hybrid mode works at all, but not suited to real agentic/chat serving — so treat it as a feasibility probe, not a replacement for the current vLLM stack.
- The `kyuz0` toolbox site OP links is the same upstream project this machine's vLLM image (`kyuz0/vllm-therock-gfx1151`) comes from — worth checking that page directly for any newer NPU/hybrid-related toolbox variants, since OP says it has changed significantly in the last 6 months.
- AMD's own Ryzen AI docs (`ryzenai.docs.amd.com`) are the primary/official source for how hybrid mode and model conversion actually work — start there rather than reverse-engineering from secondhand summaries.
- No vLLM-specific hybrid NPU support is mentioned anywhere in the post — Lemonade and AMD's hybrid/ONNX (OGA) tooling are a separate stack from vLLM. Realistically, testing this on this machine means running Lemonade as a **separate, parallel process/container** to sanity-check NPU usability, not modifying the existing vLLM Compose service.
- The MTP-hybrid combination OP wants (relevant to this machine's actual model, Qwen3.6-35B-A3B) does not exist yet per OP — it requires converting a GGUF to ONNX/OGA format for the NPU's "processor shape," which OP flags as non-trivial ("can't simply be converted"). Not actionable today; worth revisiting if the community produces a working conversion.

### Still unclear / needs further verification

- No comments were retrieved, so any pushback, corrections, or "this doesn't actually work / already tried it" replies from the r/LocalLLaMA community are unknown.
- No benchmark numbers at all were given for NPU prompt-processing speed, hybrid-mode throughput, or the claimed "parallel firing" behavior — OP's "crazy fast" is qualitative only.
- Whether Lemonade / hybrid mode works under Linux + Docker (this machine's actual environment) is not addressed by OP at all — OP doesn't mention their OS or whether they're running bare-metal or containerized.
- Whether Lemonade and the existing `kyuz0` vLLM container can coexist on the same GPU/NPU device nodes without conflict is untested and unmentioned.
- MTP + hybrid-mode for Qwen3.6-class models is confirmed *not yet done* by anyone per OP — it's a stated wishlist, not a working recipe. Do not attempt to follow "instructions" for this from the earlier (unverified, chatbot-generated) content elsewhere in this file, since no such recipe exists yet per this thread's OP.

## Qwen3.6-35B-A3B real benchmark data — kyuz0 toolboxes site (verified 2026-07-22)

Source: `https://kyuz0.github.io/amd-strix-halo-toolboxes/`, underlying data pulled directly from `https://kyuz0.github.io/amd-strix-halo-toolboxes/results.json` (the page renders this JSON client-side; WebFetch alone only sees the empty page shell, so the raw JSON was fetched directly to get real numbers). This is real, machine-generated benchmark data (not an LLM's guess), run on a Framework Desktop / Ryzen AI MAX 395+ / 128GB unified RAM — same chip family as this machine (gfx1151) — via `llama.cpp`. Data generated 2026-05-18, on Fedora Linux 43, kernel 6.19.12.

**Answering the question "could 35B-A3B at 16-bit quant hit 300+ tok/sec?" — no, not for text generation.** The actual `Qwen3.6-35B-A3B-BF16` results (30 runs across 5 backend environments: `rocm-7_2_3`, `rocm6_4_4`, `rocm7-nightlies`, `vulkan_amdvlk`, `vulkan_radv`, all with flash attention on, `ngl=99`):

- **Text generation (tg128, default/short context)**: best result was **26.01 tok/s** (ROCm 7.2.3). ROCm 6.4.4 and ROCm 7-nightlies were close behind (~25-26 tok/s). Vulkan backends were much slower for TG: RADV 10.68 tok/s, AMDVLK 11.6 tok/s.
- **Prompt processing (pp512, default context)**: this is where large numbers show up — ROCm 6.4.4 hit **573.71 tok/s**, ROCm 7.2.3 hit 525.94, ROCm 7-nightlies 528.97 tok/s. Vulkan RADV hit 328.4 tok/s, AMDVLK only 122.89 tok/s. **So the "300+ tok/s" figure is real, but it's a prompt-processing (prefill) number, not a generation (decode) speed** — likely what's being misread on the page.
- Longer contexts degrade both PP and TG somewhat (e.g. BF16 ROCm 7.2.3: pp2048@32k context = 417.86 tok/s, pp2048@65k context = 322.65 tok/s; tg32@32k = 23.91 tok/s, tg32@65k = 22.2 tok/s).

For comparison, quantized variants of the same model (also in the dataset) generate much faster than BF16:
- **Q4_K_XL**: tg128 best = **60.43 tok/s** (Vulkan RADV) / ~51 tok/s (ROCm). pp512 best = 1120 tok/s (ROCm 7.2.3).
- **Q8_K_XL**: tg128 best = **46.53 tok/s** (Vulkan AMDVLK) / ~46 tok/s (ROCm). pp512 best = ~1095 tok/s (ROCm).

**Takeaway for this machine**: BF16 (full 16-bit) is the slowest option for actual token generation (~26 tok/s ceiling) despite having the fastest-looking prompt-processing numbers on the page — the 300+ figures on that page are PP throughput, not TG/decode throughput, and pp512 is a burst/short-prompt metric, not sustained output speed. If generation speed for interactive/agentic use is the priority, the quantized (Q4_K_XL or Q8_K_XL) variants roughly double-to-triple TG speed vs BF16 on this hardware class. Also notable: ROCm environments substantially beat Vulkan for prompt processing on BF16, but Vulkan RADV actually wins on TG for the quantized variants — backend choice matters and isn't uniformly "ROCm always wins."

## Lemonade Server & Ollama — verified against official sources (2026-07-24), corrects the Reddit-based speculation above

The Reddit-thread research above was explicitly flagged as low-confidence (single unverified OP post, OS/Docker environment never stated). Re-researched directly against official docs/repos before any setup work, per Phase 5.6.

**Lemonade Server — Hybrid Mode (the entire reason it was on the list) is Windows-only, full stop.** Confirmed via the project's own FAQ (`github.com/lemonade-sdk/lemonade/blob/main/docs/guide/faq.md`), verbatim: *"Ryzen AI SW's implementation of NPU and hybrid inference is currently supported only on Windows."* Linux and Docker are both genuinely supported (official image `ghcr.io/lemonade-sdk/lemonade-server:latest`, official install docs for Ubuntu/Debian/Fedora/Arch, OpenAI-compatible API at `/v1`) — but on Linux, Lemonade's own GPU story for this chip is just "use the experimental `vllm:rocm` backend," i.e., the same vLLM we already run. **Conclusion: not worth pursuing.** It would not touch the idle NPU on this machine's actual OS — it would just be a second OpenAI-compatible server duplicating vLLM's existing GPU-only path. The NPU-idle problem remains genuinely unsolved on Linux as of this check; no known tool here changes that today.

**Ollama — mechanically straightforward, but gfx1151-on-Linux has two open, unresolved upstream regressions worth taking seriously.** Official image `ollama/ollama:rocm`, same `--device /dev/kfd --device /dev/dri` + video/render group pattern as the existing vLLM containers, OpenAI-compatible API confirmed (`/v1/chat/completions`), gfx1151 officially listed as supported hardware (`docs.ollama.com/gpu`). However:
- `ollama/ollama#13589` (open): gfx1151 (Radeon 8060S/8050S) silently falls back to CPU on Linux despite `rocminfo` correctly detecting the GPU — confirmed working on Windows, broken on Linux, unresolved.
- `ollama/ollama#15336` (open): a regression where 0.17.7 worked correctly on Strix Halo but 0.18.x+ broke GPU detection ("filtering device which didn't fully initialize").

**Implication for any Ollama benchmark data gathered on this machine**: silent CPU fallback is the specific, real, twice-reported failure mode on this exact chip — any speed numbers gathered must be validated against actual GPU utilization (e.g. `node_amdgpu_busy_percent` via the Grafana dashboard, or `amdgpu_top`) at the time of the benchmark, not just trusted because the container started and returned tokens. Pin to a version at or before 0.17.7 rather than `latest`/`rocm` unqualified, given the 0.18.x+ regression.

## Second deep-dive pass (2026-07-24): FastFlowLM (real NPU answer) and confirmed-working MTP

Requested explicitly to check whether the first two research passes (model candidates; Lemonade/Ollama) were genuinely thorough rather than a shallow first hit. This pass found two significant, previously-missed leads.

**FastFlowLM — a real, current, Linux-native answer to the idle-NPU problem, independent of Lemonade.** Actively maintained (`github.com/FastFlowLM/FastFlowLM`), explicitly lists Strix Halo as supported, added native Linux support March 2026, and AMD itself announced integration with it in July 2026 — this is not a hobby project. Runs LLM inference **entirely on the NPU** (no GPU/CPU load), Ollama-like CLI/API. Real requirements/caveats: Linux kernel 7.0+ (or the `amdxdna-dkms` backport), NPU firmware ≥1.1.0.0, and **AMD IOMMU must be enabled** — worth noting IOMMU is sometimes disabled specifically to maximize iGPU throughput on Strix Halo boxes, so enabling it for NPU use may cost a small amount of iGPU performance (one community report: +3.29% latency on a concurrent 64K iGPU workload — a real tradeoff to weigh, not free). A known Ubuntu 25.10 firmware/driver mismatch bug is open upstream (`amd/xdna-driver#1219`) — worth checking against this machine's actual NixOS kernel/firmware pairing before attempting setup, not assuming it'll just work. AMD's own Ryzen AI Software / ONNX Runtime GenAI (OGA) stack exists independently of Lemonade too, but is fundamentally Windows/ONNX-first with no clean native-Linux path found — FastFlowLM is the one credible current answer.

**MTP speculative decoding is confirmed working today — via llama.cpp, not vLLM.** llama.cpp merged native MTP support (`ggml-org/llama.cpp` PR #22673, merged 2026-05-16) for models shipping MTP heads, including Qwen3.6-27B and Qwen3.6-35B-A3B — both already in this machine's lineup. This has been **specifically benchmarked on Strix Halo/gfx1151** in two independent places (kyuz0's own toolboxes site has a dedicated `mtp.html` page; calebcoffie.com has independent numbers): reported speedups of **1.8x-2.5x** (e.g., Qwen3.6-27B Q4_K_M going from 11.7 to 21.2 tok/s), draft acceptance rate ~72% at depth 3. Real caveats: `n_parallel=1` only (no concurrent request serving while using MTP), and ROCm+tensor-parallel combinations reportedly crash — Vulkan is the safer backend for this specifically. **No vLLM MTP evidence on this hardware was found** — vLLM's `qwen3_next_mtp` path remains unconfirmed on ROCm, consistent with the existing roadmap note; MTP being "real" is specific to the llama.cpp path, not a green light for vLLM.

**Other serving backends checked, mostly dead ends:** SGLang has no official ROCm support for gfx1151 (open feature request `sgl-project/sglang#5131`); a community-patched Docker image exists (`JeremiahM37/strix-halo-sglang`) but is unproven/non-upstream. MLC-LLM: no gfx1151 evidence found. ExLlamaV2/TabbyAPI: no AMD/ROCm support at all, a hard dependency-level no. llama.cpp run directly (not via Ollama) is the one clearly worthwhile alternative beyond Ollama itself — Vulkan/RADV frequently beats ROCm for token generation on this chip (memory-bandwidth bound), and critically it exposes MTP, which Ollama's bundled llama.cpp build does not currently support.

**Also found: a genuinely new model candidate, `CohereLabs/North-Mini-Code-1.0-w4a16`.** 30B total/3B active MoE (same winning size class as Qwen3.6-35B-A3B / Gemma-4-26B-A4B-it on this hardware), released June 2026, purpose-built for agentic coding, ~18-20GB on disk (W4A16, BF16 activations — not the disqualifying FP8 variant), 256K context, native vLLM `cohere_command4` tool-call parser, no TP requirement. Zero direct Strix-Halo evidence yet (too new) — same "theoretical compatibility, needs real testing" caveat as GPT-OSS before it was tested. Disqualified in the same pass: GLM-5.2 (743B total, way too large even quantized), DeepSeek V4 Pro/Flash (1.6T total, same reason).

## Third pass (2026-07-24): fact-checking a cold Gemini query — real leads kept, fabricated numbers caught and rejected

Chris asked a different AI (Gemini, no confirmed tool access) the same kind of research question cold, across three rounds (model/engine recommendations, then a refinement for concurrent multi-agent + large-context workloads, then a further refinement after DeepSeek V4 was caught as wrong). Every specific, checkable claim was verified against real sources before being trusted — this is the record of what held up and what didn't.

**Held up (real, sourced, kept):**
- The full four-row performance table from round one (GPT-OSS-120B, Qwen3.5-122B-A10B, NVIDIA-Nemotron-3-Super-120B-A12B, MiniMax-M2.7) — all four verified as genuine entries in kyuz0's raw `results.json`, not hallucinated (Gemini's numbers were directionally right but rounded/imprecise — e.g. stated "~22" vs actual 22.30 tok/s). Nemotron-3-Super and MiniMax-M2.7 are real models we hadn't considered; Qwen3.5-122B is a new GGUF quant of a model we already own in AWQ form. All three approved and downloading as of this pass.
- `llama.cpp build 9193` — real, exact build hash reference used in that same benchmark dataset.
- `rocWMMA` for ROCm flash-attention on long context — real, independently corroborated optimization (`GGML_HIP_ROCWMMA_FATTN`), though not part of the specific dataset cited.
- `amd-ttm` — a real AMD-published CLI tool (from `amd-debug-tools`), contrary to initial suspicion it was invented. It's a runtime-equivalent to our existing boot-param approach (`amdgpu.gttsize`/`ttm.pages_limit`), not a superior alternative — no action needed since we already have the equivalent mechanism.
- PagedAttention/continuous batching reasoning for multi-tenant serving — accurate, standard vLLM architecture, not hardware-specific but not wrong either.

**Fabricated or unverifiable — rejected:**
- **Two separate wildly-inflated throughput claims for Qwen3.6-35B-A3B** — first "~300 t/s" (round one, likely the same prompt-processing-vs-generation confusion this project already caught once from a different source), then "~181 tokens/sec (vLLM ROCm TP1)" (round three, framed as "verified"). Our own real, directly-measured number for this exact model is **33.19 tok/s at concurrency 8** — over 5x lower than the second claim. Neither number was accompanied by a real, checkable source.
- **DeepSeek V4 Flash recommendation** (round two) — self-corrected by Gemini in round three after being caught (1.6T total params for V4-Pro / 284B for V4-Flash, both already disqualified in this project's own earlier research for being too large even quantized).
- **FP8 KV cache as a real performance win** — this hardware has no FP8 matrix-core compute at all (confirmed repeatedly elsewhere in this project); even if vLLM's FP8 KV-cache feature doesn't outright crash on ROCm/gfx1151, there's no evidence it delivers a real speedup rather than emulating at BF16 speed. "Configure LiteLLM to use FP8 KV caching" (round three) is also a category error — LiteLLM is a routing gateway, it has no KV cache to configure.
- **"July 2026 build fixes Q8_0/Q4_0 KV-cache decode collapse, +30-50%"** — unverifiable. Real, adjacent work exists (llama.cpp gfx1151 prefill issues, TurboQuant KV compression discussion) but nothing ties to this specific claim or figure.
- **Llama 3.1 70B AWQ-4bit** — admitted by Gemini itself to be unbenchmarked ("not directly benched... scales linearly based on the 35B metrics" — extrapolated from the already-debunked 181 tok/s figure). kyuz0's actual vLLM-toolboxes benchmark data has no Llama 3.1 70B entry at all. Also a dense model, and every dense model actually tested on this hardware (Gemma-4-31B, Qwen3.6-27B) has underperformed the MoE tier by a wide margin — low-priority even setting the fabrication aside.
- **"MLX Engine ROCm backend... beating vLLM by up to 85%... simultaneous GPU+NPU execution"** (round three) — the most instructive fabrication. `lemon-mlx-engine` is a real, independent project targeting ROCm (not Apple's own MLX, which has no ROCm support beyond an open feature request), and the cited `lemonade-sdk/lemonade#1642` issue is real — but the benchmark numbers *inside that issue* trace back to a GitHub account that has since been deleted (`author_association: NONE`, ghost account) and a linked benchmark repo that returns a 404 — it doesn't exist. Gemini repeated numbers from an already-unverifiable source as established fact, with no apparent awareness the evidence chain doesn't hold. Integration into mainline Lemonade is also stalled (two unmerged PRs). Not pursued.

**Takeaway for future research passes**: a cold LLM query without real tool/browsing access is a reasonable way to surface *candidate leads* (several of the real ones above were genuinely new and worth pursuing), but every specific number, benchmark claim, or "verified" framing needs independent verification against a real, checkable source before being trusted — the failure mode isn't random noise, it's confident, specific-sounding fabrication (exact tok/s figures, exact build numbers, named GitHub issues) that reads identically to real findings until checked.

## Gemma-4-26B-A4B GGUF benchmark: llama.cpp direct vs Ollama (2026-07-24)

Benchmarked the already-downloaded `unsloth/gemma-4-26B-A4B-it-GGUF` Q4_K_M file (`/var/lib/ai-models/ollama-gemma-4-26b-a4b-it/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf`, 15.77 GiB on disk, 25.23B total params) — same file used for both backends, so this is a clean backend-only comparison (no quant-format confound, unlike the earlier GLM-4.7-Flash AWQ-vs-GGUF comparison). `vllm-primary`/`vllm-judge` stopped throughout to remove GPU contention; restarted at the end.

**llama.cpp direct (`kyuz0/amd-strix-halo-toolboxes:vulkan-radv`, Vulkan/RADV backend), two runs — one contaminated by a concurrent background download, one clean:**

```
docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
  -v /var/lib/ai-models/ollama-gemma-4-26b-a4b-it:/models:ro \
  kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  llama-bench -m /models/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
```

(Note: this image's `llama-bench` build uses `-lm none`/`--load-mode none` rather than the deprecated `--no-mmap` flag documented elsewhere — `--no-mmap` errors out on this build with "invalid parameter for argument.")

- **First run — contaminated**: an `hf download` process (`download-model-ollama-qwen3.6-35b-a3b.service`, pulling `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf`) was actively running in the background, discovered only after the fact. Result: **pp512 = 1192.75 ± 11.10 tok/s, tg128 = 54.50 ± 0.29 tok/s**.
- **Second run — clean**, confirmed via `ps aux` (no `hf`/huggingface process) and `systemctl list-units 'download-model-*'` (no "activating" units) both immediately before and after the run: **pp512 = 1251.33 ± 17.08 tok/s, tg128 = 53.96 ± 0.15 tok/s**.
- **Contention delta**: PP dropped ~4.9% under concurrent download load (1251.33 → 1192.75) — a real, measurable cost, plausibly the download's disk/network I/O competing for unified-memory bandwidth during prefill's higher-throughput phase. TG was statistically unaffected (53.96 vs 54.50, well within the ±0.15-0.29 run-to-run noise band) — consistent with TG being bottlenecked purely on GPU-side memory bandwidth per-token, a regime a background CPU-side download doesn't meaningfully compete in. **Practical takeaway: PP-sensitive benchmarks (prefill-heavy workloads, RAG-style long-context ingestion) should have the download queue paused first; TG-only comparisons are robust to it.**
- **Clean numbers are the benchmark-of-record for this model**: pp512 1251.33 tok/s / tg128 53.96 tok/s.

**Comparison to GLM-4.7-Flash's benchmark-of-record (81.3 PP / 70.1 TG, same toolbox/methodology)**: Gemma-4-26B-A4B is markedly *slower* on both axes despite being the model that previously posted the best vLLM concurrency/coding-benchmark results of anything tested (see 5.3/5.6 in `README.md`) — a reminder that vLLM-serving fitness and raw llama.cpp/GGUF decode speed don't necessarily rank models the same way. Plausible factor: Gemma-4-26B-A4B is a larger total-param model (25.23B vs GLM-4.7-Flash's ~30B-total/~3B-active — comparable MoE shape, but Gemma-4-26B-A4B's own vLLM footprint numbers elsewhere in this doc show larger KV cache/less concurrency headroom) — not a controlled ablation, just an observed correlation worth noting for future model comparisons.

**Ollama — real, version-specific incompatibility found; not benchmarked.** Registered the same GGUF via `scripts/ollama_register_model.sh ollama-gemma-4-26b-a4b-it gemma-4-26B-A4B-it-UD-Q4_K_M.gguf gemma-4-26b-a4b-gguf` (succeeded — `ollama create` completed, `ollama list` shows `gemma-4-26b-a4b-gguf:latest`, 16GB). A real chat/generate request against it failed outright:

```
llama_model_load: error loading model architecture: unknown model architecture: 'gemma4'
llama_model_load_from_file_impl: failed to load model
```

This is **Ollama 0.17.7's bundled ggml/llama.cpp build not recognizing the `gemma4` GGUF architecture tag** — Gemma-4 is architecturally newer than what that specific Ollama build's vendored inference engine supports, independent of the Vulkan/ROCm backend-selection issue this same pin was chosen to work around (see the 5.6 GLM-4.7-Flash entries above). Confirmed via `docker logs ollama` (full GGUF metadata parses fine — tensors, tokenizer, chat template all load — the failure is specifically at the architecture-dispatch step) and `/api/version` (confirms `0.17.7`, the correct/expected pin, not a stale image). **Not a config or download problem, and not something a retry or workaround fixes** — this Ollama version genuinely cannot serve this model. A newer Ollama build likely supports `gemma4` (it postdates 0.17.7's release), but jumping to 0.18.x+ reintroduces the previously-found GPU-detection regression (`ollama/ollama#15336`) on this exact chip. **This is a real, currently-unresolved version tradeoff — pin for Vulkan-and-GPU-detection correctness (0.17.7) vs pin for newer-model-architecture support (0.18.x+) — not something to solve unilaterally right now; flagged for a later decision.**

**Net conclusion**: llama.cpp direct is the only backend that can currently serve this exact file at all on this box — Ollama 0.17.7 is a hard architecture-support blocker, not a speed disadvantage, for Gemma-4-26B-A4B specifically (unlike GLM-4.7-Flash, where Ollama worked but was ~5.4x slower than llama.cpp direct: 13 vs 70.1 tok/s). Benchmark-of-record for this model: **llama.cpp direct, pp512 1251.33 tok/s / tg128 53.96 tok/s**; Ollama comparison not obtainable until the architecture-support/GPU-detection version tradeoff above is resolved.

## Qwen3.6-27B GGUF benchmark: llama.cpp direct vs Ollama (2026-07-24)

Benchmarked the newly-completed `unsloth/Qwen3.6-27B-GGUF` Q4_K_M file (`/var/lib/ai-models/ollama-qwen3.6-27b/Qwen3.6-27B-Q4_K_M.gguf`, 16.8GB on disk, 15.65 GiB / 26.90B params per `llama-bench`'s own report) — same house methodology as the GLM-4.7-Flash and Gemma-4-26B-A4B GGUF runs above. Before any timed measurement: checked for an active download queue (`ps aux | grep -iE "hf download|nix.*download "` and `systemctl list-units 'download-model-*' --all --no-legend | grep activating`) — found **7 units actively "activating"** behind the shared flock (gpt-oss-120b, gpt-oss-20b, llamacpp-gpt-oss-120b, llamacpp-minimax-m2.7, llamacpp-nemotron-3-super-120b, llamacpp-qwen3.5-122b-a10b, north-mini-code-1.0-w4a16, plus ollama-qwen3.6-35b-a3b queued behind the flock). Stopped all of them in one `systemctl stop` command, ran both benchmarks below, then resumed all of them with `systemctl start` at the end — confirmed they went back to "activating" afterward. `vllm-primary`/`vllm-judge` were also stopped for the duration to remove GPU contention, and restarted (confirmed healthy on `/health` for both 8000 and 8001) once both benchmarks completed.

**llama.cpp direct (`kyuz0/amd-strix-halo-toolboxes:vulkan-radv`, Vulkan/RADV backend):**

```
docker run --rm --device /dev/kfd --device /dev/dri --group-add 26 --group-add 303 \
  -v /var/lib/ai-models/ollama-qwen3.6-27b:/models:ro \
  kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  llama-bench -m /models/Qwen3.6-27B-Q4_K_M.gguf -ngl 999 -fa 1 -lm none
```

Result: **pp512 = 342.55 ± 14.41 tok/s, tg128 = 12.75 ± 0.03 tok/s**. This is by far the slowest llama.cpp-direct generation number recorded in this project so far — well behind both GLM-4.7-Flash (70.1 tok/s) and Gemma-4-26B-A4B (53.96 tok/s), both of which are MoE models with a fraction of Qwen3.6-27B's ~27B *active* params per token. Consistent with the dense-vs-MoE gap already established via this same model's vLLM entry (`MODEL_STACK_CATALOG.md`'s "Qwen3.6-27B — vLLM" entry, dense architecture, markedly slower than the MoE 35B-A3B primary) — this is now the second independent engine (llama.cpp, not just vLLM) confirming dense-architecture cost on this hardware.

**Ollama:**

```
./scripts/ollama_register_model.sh ollama-qwen3.6-27b Qwen3.6-27B-Q4_K_M.gguf qwen3.6-27b-gguf
curl -sS localhost:11434/api/generate -d '{"model":"qwen3.6-27b-gguf","prompt":"...","stream":false}'
```

Registration succeeded immediately (`ollama create` completed cleanly, `ollama list` shows `qwen3.6-27b-gguf:latest`, 16GB). Unlike Gemma-4-26B-A4B (hard `unknown model architecture: 'gemma4'` blocker on this Ollama build), **Qwen3.6 is a recognized/supported architecture** — the generation request succeeded and returned a full response (including a `<think>` reasoning trace). From the JSON response: `eval_count: 613`, `eval_duration: 57871769652` ns → **613 / 57.87 = 10.59 tok/s**. This is somewhat below the llama.cpp-direct number for the same file (12.75 tok/s) — roughly a 17% gap, much narrower than GLM-4.7-Flash's ~5.4x Ollama-overhead gap. Caveat: this was a single real `/api/generate` sample (with reasoning-mode overhead inflating the token count), not an averaged `llama-bench`-style run, so the two numbers are directionally comparable rather than a precise controlled ablation.

**Net conclusion**: Qwen3.6-27B works on both llama.cpp direct and Ollama — no architecture-support blocker here (Qwen3-family architectures are well-supported by this Ollama build, unlike Gemma-4's newer tag). Both numbers are the slowest GGUF-based generation speeds recorded in this project to date, reinforcing that this specific model's dense (not MoE) architecture is the dominant cost, not the serving engine. Raw results saved per the house rule: `results/qwen3.6-27b--llamacpp.txt` and `results/qwen3.6-27b--ollama.txt`.
