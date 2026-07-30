# Adds the docker CLI, an ssh client, and gh to the upstream Turnstone
# image so a workstream's shell tool can actually run `docker build`,
# `git push`/`fetch` over SSH, and `gh pr create` against a mounted
# project (see docker-compose.yml's turnstone service).
FROM ghcr.io/turnstonelabs/turnstone:latest

USER root

# docker.io alone is NOT enough - confirmed directly (deployed, tested,
# found broken): on this Debian (trixie) packaging, docker.io only
# RECOMMENDS the actual docker-cli package rather than depending on it,
# and --no-install-recommends (the first attempt) skipped it, so the
# `docker` binary never actually existed despite the daemon/plumbing
# packages installing cleanly with no error. docker-cli is listed
# explicitly here, not left to Recommends.
# openssh-client: git needs a real `ssh` binary for SSH remotes - also
# confirmed missing on the first attempt ("error: cannot run ssh: No
# such file or directory").
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        docker.io \
        docker-cli \
        openssh-client \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# gh (GitHub CLI) isn't packaged in Debian at all - installed from the
# upstream release tarball directly rather than adding GitHub's apt repo
# + GPG key for a single-purpose image.
RUN GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
        | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/') \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh \
    && rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_amd64"

USER turnstone
