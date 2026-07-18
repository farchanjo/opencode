ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/bun-node:24.04@sha256:14ce095b02085ba2edf14df9884b1ac072b97d2264fd19d006d57da4f1b2f8a8

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    docker.io \
    pacman-package-manager \
  && rm -rf /var/lib/apt/lists/*
