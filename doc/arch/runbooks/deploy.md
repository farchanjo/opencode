# Deploy Runbook — opencode

Operational runbook for building and releasing opencode from a clean
checkout. Follow the steps in order and never skip the verification section.

## Purpose

Describe how to build, validate, and release opencode. This is the
single procedure operators follow to cut a release, so it stays generic — wire
the build steps below to the project's real toolchain.

## Trigger

Run this procedure when:

- A release is scheduled or a release tag is requested.
- An approved change has merged to the release branch and must be shipped.

## Preconditions

- The working tree is clean and checked out on the intended release commit.
- Required tooling is available: `make`, `git`, and the `speckit` binary.
- Credentials for the release target are configured in the environment.

## Steps

1. Sync the repository: `git fetch --all` and check out the release commit.
2. Validate the spec corpus: `speckit validate` — it must exit `0`.
3. Build the project: `make build`.
4. Run the test suite: `make test`.
5. Run the full gate before publishing: `make check`.

## Verification

- `speckit validate` exits `0` with no errors reported.
- `make check` passes (build, tests, and spec gates all green).
- The release artifact exists and its version matches the release commit.

## Rollback

If any step fails or verification does not pass:

1. Stop the release immediately; do not publish partial artifacts.
2. Check out the previous known-good release tag.
3. Re-run `make check` on the reverted state to confirm stability.
4. Record the failure and open a follow-up before attempting the release again.
