//! `oc_grep` — embedded content search at parity with the output shapes of
//! `packages/core/src/ripgrep.ts` (FR6, C4, C5, AC7).
//!
//! Uses the embedded `grep-searcher` / `grep-regex` / `ignore` engine — there is
//! **no external `rg` subprocess** on this path. Supports the three output modes:
//! `files_with_matches`, `content` (line numbers + match text), and `count`
//! (per-file match totals). A bad regex yields the typed `invalid_pattern` error.
//!
//! Results are sorted deterministically by `(path, line_number, byte_offset)` so the
//! parity comparison against the reference is stable after undefined-tie
//! normalization; `.gitignore` is honored and `.git/` is always excluded, matching
//! the reference walk (`--hidden --glob=!**/.git/**`).

use std::path::Path;

use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::{Searcher, SearcherBuilder};
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use opencode_ffi_abi::{FfiError, FfiErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The grep output mode, mirroring `ffi.enums.#GrepOutputMode`.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrepOutputMode {
    FilesWithMatches,
    Content,
    Count,
}

/// `oc_grep` request — mirrors `ffi.tools.#GrepRequest`.
#[derive(Deserialize)]
pub struct GrepRequest {
    pub pattern: String,
    #[serde(default)]
    pub path: Option<String>,
    pub mode: GrepOutputMode,
    #[serde(default)]
    pub glob: Option<String>,
    /// Accepted for wire-compatibility with `ffi.tools.#GrepRequest`; the reference
    /// `ripgrep.ts` grep path emits no surrounding context, so this is not consumed.
    #[serde(default)]
    #[allow(dead_code)]
    pub context_lines: Option<u64>,
}

/// One content-mode match — mirrors `ffi.tools.#GrepMatch`.
#[derive(Serialize)]
struct GrepMatch {
    path: String,
    line_number: u64,
    byte_offset: u64,
    text: String,
}

/// One count-mode entry — mirrors `ffi.tools.#GrepFileCount`.
#[derive(Serialize)]
struct GrepFileCount {
    path: String,
    count: u64,
}

/// `oc_grep` result — mirrors `ffi.tools.#GrepResult` (only the mode-relevant
/// collection is populated; the others are `null`).
#[derive(Serialize)]
struct GrepResult {
    mode: &'static str,
    matches: Option<Vec<GrepMatch>>,
    files: Option<Vec<String>>,
    counts: Option<Vec<GrepFileCount>>,
}

const GREP_TEXT_CAP: usize = 2_000;

/// UTF-16 code-unit truncation matching `ripgrep.ts` (`slice(0, 2000) + "..."`).
fn cap_text(text: &str) -> String {
    let units: usize = text.chars().map(|c| c.len_utf16()).sum();
    if units <= GREP_TEXT_CAP {
        return text.to_string();
    }
    let mut out = String::new();
    let mut count = 0usize;
    for ch in text.chars() {
        let width = ch.len_utf16();
        if count + width > GREP_TEXT_CAP {
            break;
        }
        out.push(ch);
        count += width;
    }
    out.push_str("...");
    out
}

/// The relative path of `entry` under `root`, forward-slash normalized, matching the
/// reference (which strips the leading `./` rg emits).
fn relative_path(root: &Path, entry: &Path) -> String {
    let rel = entry.strip_prefix(root).unwrap_or(entry);
    let text = rel.to_string_lossy();
    text.replace('\\', "/")
}

fn searcher() -> Searcher {
    SearcherBuilder::new().line_number(true).build()
}

/// Build the `ignore` walk honoring `.gitignore`, including hidden files, excluding
/// `.git/`, and applying the optional include glob as a whitelist.
fn build_walk(root: &Path, glob: &Option<String>) -> Result<ignore::Walk, FfiError> {
    let mut overrides = OverrideBuilder::new(root);
    if let Some(pattern) = glob {
        overrides
            .add(pattern)
            .map_err(|err| FfiError::new(FfiErrorCode::InvalidRequest, format!("{err}")))?;
    }
    overrides
        .add("!**/.git/**")
        .map_err(|err| FfiError::new(FfiErrorCode::InvalidRequest, format!("{err}")))?;
    let overrides = overrides
        .build()
        .map_err(|err| FfiError::new(FfiErrorCode::InvalidRequest, format!("{err}")))?;
    Ok(WalkBuilder::new(root)
        .hidden(false)
        .overrides(overrides)
        .build())
}

/// Run `oc_grep` against the filesystem and produce the `#GrepResult`.
pub fn grep(req: GrepRequest) -> Result<Value, FfiError> {
    let matcher = RegexMatcher::new(&req.pattern)
        .map_err(|err| FfiError::new(FfiErrorCode::InvalidPattern, format!("{err}")))?;

    let root = Path::new(req.path.as_deref().unwrap_or("."));
    let walk = build_walk(root, &req.glob)?;

    let mut matches: Vec<GrepMatch> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut counts: Vec<GrepFileCount> = Vec::new();

    for result in walk {
        let entry = match result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let rel = relative_path(root, path);

        match req.mode {
            GrepOutputMode::Content => {
                let mut local: Vec<GrepMatch> = Vec::new();
                let sink = UTF8(|line_number, line| {
                    // grep-searcher's byte offset is not exposed through the UTF8
                    // sink; recompute a stable secondary key below.
                    local.push(GrepMatch {
                        path: rel.clone(),
                        line_number,
                        byte_offset: 0,
                        text: cap_text(line),
                    });
                    Ok(true)
                });
                let _ = searcher().search_path(&matcher, path, sink);
                assign_offsets(path, &mut local);
                matches.extend(local);
            }
            GrepOutputMode::FilesWithMatches => {
                let mut found = false;
                let sink = UTF8(|_line_number, _line| {
                    found = true;
                    Ok(false)
                });
                let _ = searcher().search_path(&matcher, path, sink);
                if found {
                    files.push(rel);
                }
            }
            GrepOutputMode::Count => {
                let mut count = 0u64;
                let sink = UTF8(|_line_number, _line| {
                    count += 1;
                    Ok(true)
                });
                let _ = searcher().search_path(&matcher, path, sink);
                if count > 0 {
                    counts.push(GrepFileCount { path: rel, count });
                }
            }
        }
    }

    matches.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.line_number.cmp(&b.line_number))
            .then(a.byte_offset.cmp(&b.byte_offset))
    });
    files.sort();
    counts.sort_by(|a, b| a.path.cmp(&b.path));

    let result = match req.mode {
        GrepOutputMode::Content => GrepResult {
            mode: "content",
            matches: Some(matches),
            files: None,
            counts: None,
        },
        GrepOutputMode::FilesWithMatches => GrepResult {
            mode: "files_with_matches",
            matches: None,
            files: Some(files),
            counts: None,
        },
        GrepOutputMode::Count => GrepResult {
            mode: "count",
            matches: None,
            files: None,
            counts: Some(counts),
        },
    };
    Ok(serde_json::to_value(result).expect("grep result serializes"))
}

/// Recompute each matched line's absolute byte offset by locating its 1-based line
/// start in the file, so `byte_offset` mirrors rg's `absolute_offset` tie-break key.
fn assign_offsets(path: &Path, local: &mut [GrepMatch]) {
    if local.is_empty() {
        return;
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return,
    };
    // Offset of the start of each 1-based line.
    let mut line_starts: Vec<u64> = Vec::with_capacity(64);
    line_starts.push(0);
    for (index, &byte) in bytes.iter().enumerate() {
        if byte == b'\n' {
            line_starts.push((index + 1) as u64);
        }
    }
    for m in local.iter_mut() {
        if m.line_number >= 1 {
            let idx = (m.line_number - 1) as usize;
            if let Some(&start) = line_starts.get(idx) {
                m.byte_offset = start;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture_dir(name: &str) -> std::path::PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("oc_grep_{}_{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
    }

    fn run(req: GrepRequest) -> GrepResultOwned {
        let value = grep(req).unwrap();
        serde_json::from_value(value).unwrap()
    }

    #[derive(Deserialize)]
    struct GrepMatchOwned {
        path: String,
        line_number: u64,
        #[allow(dead_code)]
        byte_offset: u64,
        text: String,
    }
    #[derive(Deserialize)]
    struct GrepFileCountOwned {
        path: String,
        count: u64,
    }
    #[derive(Deserialize)]
    struct GrepResultOwned {
        mode: String,
        matches: Option<Vec<GrepMatchOwned>>,
        files: Option<Vec<String>>,
        counts: Option<Vec<GrepFileCountOwned>>,
    }

    #[test]
    fn content_mode_reports_line_number_and_text() {
        let dir = fixture_dir("content");
        write(&dir, "a.txt", "alpha\nneedle here\nbeta\n");
        let out = run(GrepRequest {
            pattern: "needle".into(),
            path: Some(dir.to_string_lossy().into_owned()),
            mode: GrepOutputMode::Content,
            glob: None,
            context_lines: None,
        });
        assert_eq!(out.mode, "content");
        let matches = out.matches.unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "a.txt");
        assert_eq!(matches[0].line_number, 2);
        assert_eq!(matches[0].text.trim_end(), "needle here");
    }

    #[test]
    fn files_with_matches_mode_lists_distinct_files() {
        let dir = fixture_dir("files");
        write(&dir, "a.txt", "match\nmatch\n");
        write(&dir, "b.txt", "nope\n");
        write(&dir, "c.txt", "match\n");
        let out = run(GrepRequest {
            pattern: "match".into(),
            path: Some(dir.to_string_lossy().into_owned()),
            mode: GrepOutputMode::FilesWithMatches,
            glob: None,
            context_lines: None,
        });
        assert_eq!(out.mode, "files_with_matches");
        let files = out.files.unwrap();
        assert_eq!(files, vec!["a.txt".to_string(), "c.txt".to_string()]);
    }

    #[test]
    fn count_mode_reports_per_file_totals() {
        let dir = fixture_dir("count");
        write(&dir, "a.txt", "x\nx\nx\n");
        write(&dir, "b.txt", "x\ny\n");
        let out = run(GrepRequest {
            pattern: "x".into(),
            path: Some(dir.to_string_lossy().into_owned()),
            mode: GrepOutputMode::Count,
            glob: None,
            context_lines: None,
        });
        let counts = out.counts.unwrap();
        assert_eq!(counts.len(), 2);
        assert_eq!(counts[0].path, "a.txt");
        assert_eq!(counts[0].count, 3);
        assert_eq!(counts[1].path, "b.txt");
        assert_eq!(counts[1].count, 1);
    }

    #[test]
    fn glob_filter_restricts_the_walk() {
        let dir = fixture_dir("glob");
        write(&dir, "keep.ts", "target\n");
        write(&dir, "skip.md", "target\n");
        let out = run(GrepRequest {
            pattern: "target".into(),
            path: Some(dir.to_string_lossy().into_owned()),
            mode: GrepOutputMode::FilesWithMatches,
            glob: Some("*.ts".into()),
            context_lines: None,
        });
        assert_eq!(out.files.unwrap(), vec!["keep.ts".to_string()]);
    }

    #[test]
    fn gitignore_excludes_git_dir() {
        let dir = fixture_dir("gitdir");
        write(&dir, ".git/config", "target\n");
        write(&dir, "src.txt", "target\n");
        let out = run(GrepRequest {
            pattern: "target".into(),
            path: Some(dir.to_string_lossy().into_owned()),
            mode: GrepOutputMode::FilesWithMatches,
            glob: None,
            context_lines: None,
        });
        assert_eq!(out.files.unwrap(), vec!["src.txt".to_string()]);
    }

    #[test]
    fn invalid_regex_yields_invalid_pattern() {
        let err = grep(GrepRequest {
            pattern: "(".into(),
            path: Some(".".into()),
            mode: GrepOutputMode::Content,
            glob: None,
            context_lines: None,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::InvalidPattern);
    }
}
