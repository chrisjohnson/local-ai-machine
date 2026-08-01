# Build + run container for poolsideai/llama.cpp branch `laguna` with Vulkan/RADV
# (M-053: the one untried speculative-decoding candidate — real DFlash on Vulkan).
#
# The kyuz0 Strix Halo toolbox image already ships the complete runtime (Mesa RADV
# Vulkan driver) AND the dev toolchain (cmake, gcc, ninja, glslc, vulkan headers),
# so one stage serves as both builder and runtime. The built binaries land in
# /build/build/bin and the fork commit is recorded in /build/fork-commit.txt.
FROM docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv

# The toolbox image has gcc/glslc but no linker (binutils/ld) — required by
# CMake's compiler-probe before it will configure anything.
RUN dnf install -y binutils && dnf clean all

WORKDIR /build
RUN git clone --depth 1 --branch laguna https://github.com/poolsideai/llama.cpp.git /build/src \
    && git -C /build/src rev-parse HEAD > /build/fork-commit.txt

WORKDIR /build/src
RUN cmake -B /build/build -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF \
    && grep -E "GGML_VULKAN|LLAMA_VULKAN" /build/build/CMakeCache.txt \
    && cmake --build /build/build -j --target llama-server llama-bench llama-cli

WORKDIR /build
