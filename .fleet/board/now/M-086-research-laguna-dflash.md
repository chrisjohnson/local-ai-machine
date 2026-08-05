---
id: M-086
title: Research dflash laguna
initiative_id: null
claimed_by: null
claimed_at: null
blocks: null
blocked_by: null
status: null
---

# M-086 — Research dflash laguna

## Context
I've been chatting with another agent about tuning laguna s 2.1 for performance. I know we tried some things. Here's teh feedback it offered, see if any of this is actionable, and, with approval, implement the changes and benchmark. Make sure to record any findings into the catalog

This is an incredibly detailed and well-documented benchmark log. Your findings tell a clear story about why DFlash is falling flat on your Strix Halo, and it exposes a crucial hardware-software friction point.Your sweep in M-055 (where shrinking --spec-draft-n-max down to 2 or 3 raised your token acceptance but capped out exactly at your 30 tok/s baseline) proves that you are hitting the absolute execution ceiling of the Strix Halo’s LPDDR5X memory bandwidth.To find a DFlash setup that actually beats the baseline, we have to address the underlying architectural issue causing this bottleneck.The Problem: The "Block-Diffusion" Memory TaxDFlash doesn't generate tokens autoregressively (one-by-one) like a traditional draft model. It uses block diffusion to predict an entire block of tokens simultaneously in a single forward pass.On discrete GPUs (RTX 4090, Apple Silicon M-Max): Compute is massive and memory bandwidth is wide (400–1000+ GB/s). The overhead of reading the 2GB DFlash model from VRAM to guess 15 tokens is incredibly cheap compared to verifying them against the 118B base model.On Strix Halo (120-135 GB/s shared RAM): Memory bandwidth is a strict premium. To do a block step, your APU has to pull the 2GB DFlash model weights and its KV cache from system RAM, then immediately pull the 68GB base model weights.Even when your acceptance rate jumps at lower block sizes (n=2 or n=3), the time spent fetching that 2GB DFlash file from system RAM completely cancels out the tokens you saved. You end up right back at your 30 tok/s baseline.How to Move Past 30 tok/sIf you want to try to break through that 30 tok/s wall on a Strix Halo without changing your hardware, you need to test three specific adjustments.1. Quantize the DFlash Draft Model to Q4_K_M or Q8_0Your log shows you are running laguna-s-2.1-DFlash-BF16.gguf (the draft) in uncompressed BF16.The Penalty: Every single draft step forces your memory controller to pull 2GB of unquantized weights.The Fix: Quantize that DFlash draft model down to Q8_0 or Q4_K_M. This shrinks the draft footprint from 2GB down to ~500MB–1GB. This drastically reduces the memory bandwidth tax per block step and may finally give the APU enough breathing room to yield a net speedup at --spec-draft-n-max 3 or 4.2. Test the ROCm/HIP Stack via Unified MemoryYour logs note that the community achieved 73-90% acceptance rates on the ROCm/HIP backend (albeit with lower baseline speeds). The block-diffusion math in Poolside's fork relies heavily on specific FP16/BF16 matrix multiplication behaviors. Your RADV/Vulkan path is functioning mechanically, but it is clear that the block predictions are slightly misaligning, destroying your acceptance rate at higher block sizes.If you have a separate ROCm toolbox image handy, it's worth trying the quantized draft there. ROCm often handles the specific matrix math required by these custom diffusion layers with better precision than RADV translating it over Vulkan compute.3. Drop Context to Maximize the L3 / Cache LocalityYour benchmark runs a massive -c 131072 context. At 131k context, the KV cache for a 118B model takes up a massive chunk of your remaining system memory. The memory controller is completely overwhelmed tracking the base model KV cache, the base weights, and the draft model.For short context requests (where you want to beat 30 tok/s), try dropping your container context down to -c 8192 or -c 16384 just to test. This frees up significant memory bus channels and allows the Strix Halo's internal caches to better optimize the dual-model execution loop.What to Try NextIf you want to attempt to salvage the DFlash setup, I recommend keeping your Vulkan fork image but quantizing the DFlash draft file.If you'd like, let me know:Do you have the tools in your toolbox to quantize the DFlash GGUF to Q4_K_M or Q8_0?Do you want to try adjusting the container command to a smaller context window to see if the memory controller stops choking?

## Plan

## Signals

## Decision log

## Handoff notes
