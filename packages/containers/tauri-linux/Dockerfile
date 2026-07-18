ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/rust:24.04@sha256:cf23b483824ef7909a69ed4a8a8f558f1aaee9dfd7c91016d7b798eff75c52c6

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libappindicator3-dev \
    libwebkit2gtk-4.1-dev \
    librsvg2-dev \
    patchelf \
  && rm -rf /var/lib/apt/lists/*
