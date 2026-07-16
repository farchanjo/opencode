# Makefile for opencode
#
# Self-documenting: run `make` (or `make help`) to list the available targets.
# TODO (opencode maintainer): wire the Build/Test targets below to your
# project's real build system (cargo, npm, go, gradle, ...). The Spec targets
# are ready to use and drive the speckit spec-driven workflow.

.DEFAULT_GOAL := help

.PHONY: help build test lint check validate verify analyze spec-status install-hooks

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Build / Test — placeholders: replace with opencode's real toolchain.
# ---------------------------------------------------------------------------

build: ## Build the project (TODO: wire to your build system)
	@echo "TODO: build opencode — replace this recipe with your build command"

test: ## Run the test suite (TODO: wire to your test runner)
	@echo "TODO: test opencode — replace this recipe with your test command"

lint: ## Run the project linter
	bun run lint

# ---------------------------------------------------------------------------
# Spec — speckit spec-driven workflow gates (ready to use).
# ---------------------------------------------------------------------------

install-hooks: ## Activate the versioned hooks for this clone (local Git config)
	git config --local --replace-all core.hooksPath .husky
	@echo "Versioned Git hooks enabled from .husky (this clone only)"

validate: ## Validate the doc/arch spec corpus
	speckit validate

verify: ## Verify the executable specs against the implementation
	speckit verify

analyze: ## Analyze the spec corpus for gaps and drift
	speckit analyze

spec-status: ## Show the active feature and current workflow phase
	speckit status

check: validate verify analyze test ## Run the full gate (spec corpus + tests)
