//! `oc_glob` — native `.gitignore`-aware file-pattern search at parity with the
//! `glob` tool's `Ripgrep.glob` seam (FR5, FR7, FR18, C5, C13, AC6).
//!
//! Walks the tree with the embedded `ignore` engine honoring `.gitignore` and always
//! excluding `.git/`, applies the glob as a `globset`/`ignore`-overrides whitelist
//! (the same gitignore-glob semantics as `rg --glob=<pattern>`), and returns the
//! matched relative paths sorted by modification time descending (path as the
//! deterministic tie-break). A result count above the optional `limit` sets the
//! `truncated` flag. The path *set* is byte-identical to the reference; only the
//! `(mtime desc, path)` tie order — which the reference leaves undefined — differs.

use std::path::Path;
use std::time::SystemTime;

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use opencode_ffi_abi::{FfiError, FfiErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `oc_glob` request — mirrors `ffi.tools.#GlobRequest`.
#[derive(Deserialize)]
pub struct GlobRequest {
    pub pattern: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub limit: Option<u64>,
}

/// `oc_glob` result — mirrors `ffi.tools.#GlobResult`.
#[derive(Serialize, Deserialize)]
pub struct GlobResult {
    pub paths: Vec<String>,
    pub truncated: bool,
}

/// One matched entry with its mtime, used only for the mtime-desc sort.
struct Matched {
    path: String,
    mtime: SystemTime,
}

/// The relative path of `entry` under `root`, forward-slash normalized (mirrors the
/// reference which strips the leading `./` rg emits).
fn relative_path(root: &Path, entry: &Path) -> String {
    let rel = entry.strip_prefix(root).unwrap_or(entry);
    rel.to_string_lossy().replace('\\', "/")
}

fn invalid_pattern(err: impl std::fmt::Display) -> FfiError {
    FfiError::new(FfiErrorCode::InvalidPattern, format!("{err}"))
}

/// Build the `ignore` walk: honor `.gitignore`, include hidden files, exclude
/// `.git/`, and apply the glob pattern as a whitelist override.
fn build_walk(root: &Path, pattern: &str) -> Result<ignore::Walk, FfiError> {
    let mut overrides = OverrideBuilder::new(root);
    overrides.add(pattern).map_err(invalid_pattern)?;
    overrides.add("!**/.git/**").map_err(invalid_pattern)?;
    let overrides = overrides.build().map_err(invalid_pattern)?;
    Ok(WalkBuilder::new(root)
        .hidden(false)
        // Honor `.gitignore` even when the search root is not inside a git repo, so a
        // standalone tree's ignore rules apply exactly as the reference expects.
        .require_git(false)
        .overrides(overrides)
        .build())
}

/// Run `oc_glob` against the filesystem and produce the `#GlobResult`.
pub fn glob(req: GlobRequest) -> Result<Value, FfiError> {
    let root = Path::new(req.cwd.as_deref().unwrap_or("."));
    let walk = build_walk(root, &req.pattern)?;

    let mut matched: Vec<Matched> = Vec::new();
    for result in walk {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        matched.push(Matched {
            path: relative_path(root, entry.path()),
            mtime,
        });
    }

    // Sort by mtime descending, then path ascending as the deterministic tie-break.
    matched.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.path.cmp(&b.path)));

    let limit = req.limit.map(|l| l as usize).unwrap_or(usize::MAX);
    let truncated = matched.len() > limit;
    let paths: Vec<String> = matched.into_iter().take(limit).map(|m| m.path).collect();

    Ok(serde_json::to_value(GlobResult { paths, truncated }).expect("glob result serializes"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Duration;

    fn fixture_dir(name: &str) -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("oc_glob_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::File::create(path)
            .unwrap()
            .write_all(body.as_bytes())
            .unwrap();
    }

    fn run(req: GlobRequest) -> GlobResult {
        serde_json::from_value(glob(req).unwrap()).unwrap()
    }

    #[test]
    fn matches_by_extension_glob() {
        let dir = fixture_dir("ext");
        write(&dir, "a.ts", "x");
        write(&dir, "b.ts", "x");
        write(&dir, "c.md", "x");
        let out = run(GlobRequest {
            pattern: "*.ts".into(),
            cwd: Some(dir.to_string_lossy().into_owned()),
            limit: None,
        });
        let mut names = out.paths.clone();
        names.sort();
        assert_eq!(names, vec!["a.ts".to_string(), "b.ts".to_string()]);
        assert!(!out.truncated);
    }

    #[test]
    fn honors_gitignore_and_excludes_git_dir() {
        // A gitignored DIRECTORY is pruned exactly as `rg --files -g '**/*.txt'` prunes
        // it (a file whitelist glob un-ignores a named file, but a pruned directory's
        // subtree is never descended — verified against the real `rg` binary).
        let dir = fixture_dir("gitignore");
        write(&dir, ".gitignore", "build/\n");
        write(&dir, "build/out.txt", "x");
        write(&dir, "src/main.txt", "x");
        write(&dir, ".git/config", "x");
        let out = run(GlobRequest {
            pattern: "**/*.txt".into(),
            cwd: Some(dir.to_string_lossy().into_owned()),
            limit: None,
        });
        assert_eq!(out.paths, vec!["src/main.txt".to_string()]);
    }

    #[test]
    fn sorts_by_mtime_descending() {
        let dir = fixture_dir("mtime");
        write(&dir, "old.txt", "x");
        write(&dir, "new.txt", "x");
        // Make new.txt strictly newer than old.txt.
        let now = SystemTime::now();
        let old_time = now - Duration::from_secs(100);
        filetime_set(&dir.join("old.txt"), old_time);
        filetime_set(&dir.join("new.txt"), now);
        let out = run(GlobRequest {
            pattern: "*.txt".into(),
            cwd: Some(dir.to_string_lossy().into_owned()),
            limit: None,
        });
        assert_eq!(
            out.paths,
            vec!["new.txt".to_string(), "old.txt".to_string()]
        );
    }

    #[test]
    fn limit_truncates_and_flags() {
        let dir = fixture_dir("limit");
        for i in 0..5 {
            write(&dir, &format!("f{i}.txt"), "x");
        }
        let out = run(GlobRequest {
            pattern: "*.txt".into(),
            cwd: Some(dir.to_string_lossy().into_owned()),
            limit: Some(3),
        });
        assert_eq!(out.paths.len(), 3);
        assert!(out.truncated);
    }

    #[test]
    fn recursive_glob_descends_directories() {
        let dir = fixture_dir("recursive");
        write(&dir, "src/deep/a.rs", "x");
        write(&dir, "b.rs", "x");
        let out = run(GlobRequest {
            pattern: "**/*.rs".into(),
            cwd: Some(dir.to_string_lossy().into_owned()),
            limit: None,
        });
        let mut names = out.paths.clone();
        names.sort();
        assert_eq!(names, vec!["b.rs".to_string(), "src/deep/a.rs".to_string()]);
    }

    /// Set both atime and mtime of a path (test helper via std, no extra crate).
    fn filetime_set(path: &Path, time: SystemTime) {
        // `std` cannot set mtime directly; re-write with an explicit time is not
        // available either, so fall back to the `libc`-free approach: touch by
        // opening and using `set_times` on the File (stable since Rust 1.75).
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        let times = std::fs::FileTimes::new()
            .set_modified(time)
            .set_accessed(time);
        file.set_times(times).unwrap();
    }
}
