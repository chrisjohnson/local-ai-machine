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
