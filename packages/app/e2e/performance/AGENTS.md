- Prioritize stability, then simplicity, then measurement overhead.
- Use Playwright for scenario control, isolation, and completion checks.
- Use Chrome Performance traces for generic browser profiling.
- Use Electron `contentTracing` for packaged multi-process profiling.
- Keep custom probes only for product-specific measurements.
- Do not duplicate measurements across the harness, probes, and traces.
- Run benchmarks serially to avoid cross-test contention.
- Run benchmarks against production builds.
- Keep detailed profiling opt-in when it changes workload behavior.
- Preserve raw diagnostic data or use lossless representations.
- Do not enforce machine-dependent performance thresholds.
- Assert scenario completion and metric collection only.
- Keep normal test discovery free of manual benchmarks.

## Spec Kit governance on `fcustom`

- `doc/arch` is the source of truth: check `speckit status`/`speckit next`, active feature, and guard before changing performance scenarios.
- Follow `specify → clarify` (when needed) → `plan → tasks → analyze → implement → validate`, with incremental validation and the repository hook; record changed decisions.
- Do not implement Smart Routing while alternatives are open or without explicit authorization. Root `AGENTS.md` and the constitution govern; keep these performance rules intact.
