ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/base:24.04@sha256:2233bee2f0335f24c7458143d32348f0c0093e65331943532827e2d23d9008d2

SHELL ["/bin/bash", "-lc"]

ARG NODE_VERSION=24.4.0
ARG BUN_VERSION=1.3.14

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN set -euo pipefail; \
  arch=$(uname -m); \
  node_arch=x64; \
  if [ "$arch" = "aarch64" ]; then node_arch=arm64; fi; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
  | tar -xJf - -C /usr/local --strip-components=1; \
  corepack enable

RUN set -euo pipefail; \
  curl -fsSL https://bun.sh/install | bash -s -- "bun-v${BUN_VERSION}"; \
  bun --version; \
  node --version; \
  npm --version
