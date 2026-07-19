//! PTY session lifecycle: allocate a PTY, spawn a child with its own controlling
//! terminal and process group, and expose the five synchronous, single-syscall
//! operations `oc_pty_spawn` / `oc_pty_resize` / `oc_pty_kill` / `oc_pty_wait` /
//! `oc_pty_close` map onto (FR8, FR9, FR11, C9, C11, C12).
//!
//! The boundary is **synchronous** — there is no Tokio, `mio`, or reader thread on
//! this side. Async master-fd IO lives entirely on Bun's event loop
//! (`node:net.Socket({ fd })`, C9), so no FFI call sits on the IO hot path.
//!
//! Single-owner fd contract (C9, C10): `oc_pty_spawn` hands Bun a **duplicate** of
//! the PTY master fd (`libc::dup`) as the sole IO owner — Bun reads/writes and closes
//! that fd exactly once. Rust keeps the original `MasterPty` handle only to service
//! the synchronous `oc_pty_resize` ioctl and closes it on `oc_pty_close`; it never
//! reads, writes, or touches the fd integer handed to Bun.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use opencode_ffi_abi::{FfiError, FfiErrorCode};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Request / result shapes — mirror doc/arch/schemas/ffi/{pty-requests,session-parts}.cue
// ---------------------------------------------------------------------------

/// One PTY environment variable (`ffi.pty.#EnvEntry`).
#[derive(Deserialize)]
pub struct EnvEntry {
    pub name: String,
    pub value: String,
}

/// Terminal window size applied at spawn and via `TIOCSWINSZ` (`ffi.pty.#WindowSize`).
#[derive(Deserialize)]
pub struct WindowSize {
    pub cols: u16,
    pub rows: u16,
}

/// `oc_pty_spawn` request (`ffi.pty.#PtySpawnRequest`, FR8, C11).
#[derive(Deserialize)]
pub struct SpawnRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Vec<EnvEntry>,
    pub window: WindowSize,
}

/// `oc_pty_resize` request (`ffi.pty.#PtyResizeRequest`, FR9, C12).
#[derive(Deserialize)]
pub struct ResizeRequest {
    pub session_id: String,
    pub window: WindowSize,
}

/// `oc_pty_kill` request (`ffi.pty.#PtyKillRequest`, FR9, C12).
#[derive(Deserialize)]
pub struct KillRequest {
    pub session_id: String,
    pub signal: i32,
}

/// `oc_pty_wait` request (`ffi.pty.#PtyWaitRequest`, FR9, C12).
#[derive(Deserialize)]
pub struct WaitRequest {
    pub session_id: String,
}

/// `oc_pty_close` request (`ffi.pty.#PtyCloseRequest`, FR9, C9, C12).
#[derive(Deserialize)]
pub struct CloseRequest {
    pub session_id: String,
}

/// `oc_pty_spawn` success payload (`ffi.pty.#PtySpawnResult`, FR8, C9).
#[derive(Serialize, Deserialize)]
pub struct SpawnResult {
    pub session_id: String,
    pub pid: i32,
    pub master_fd: i32,
}

/// `oc_pty_wait` success payload (`ffi.pty.#PtyWaitResult`, FR9, C12).
#[derive(Serialize, Deserialize)]
pub struct WaitResult {
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/// One live PTY session: the process id, its process-group id (the child is a
/// session leader via `setsid`, so `pgid == pid`), and the retained `MasterPty`
/// handle used only for the synchronous resize ioctl and closed on teardown.
struct Session {
    pid: i32,
    pgid: i32,
    master: Box<dyn MasterPty + Send>,
    // Retained so the child process handle lives across wait/close; the process is
    // reaped through `libc::waitpid` in [`wait`] / [`close`], never a second reaper.
    _child: Box<dyn Child + Send + Sync>,
}

/// Process-wide registry keyed by the opaque `session_id`. The TypeScript registry is
/// the fd owner; this map is Rust's minimal bookkeeping so the four post-spawn calls
/// resolve their session by id alone (the requests carry no pid/pgid/fd, C10).
static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Monotonic component of the opaque session id.
static SEQ: AtomicU64 = AtomicU64::new(0);

/// Acquire the registry, tolerating poisoning from an unrelated panic.
fn sessions() -> MutexGuard<'static, HashMap<String, Session>> {
    SESSIONS.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Mint an opaque, non-guessable, process-unique session id (C10). Combines the pid,
/// a monotonic counter, and the wall-clock nanos so ids never collide or repeat.
fn mint_session_id() -> String {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("pty-{}-{seq}-{nanos}", std::process::id())
}

fn io_error(context: &str, err: impl std::fmt::Display) -> FfiError {
    FfiError::new(FfiErrorCode::IoError, format!("{context}: {err}"))
}

fn not_found() -> FfiError {
    FfiError::new(FfiErrorCode::NotFound, "unknown pty session")
}

fn pty_size(window: &WindowSize) -> PtySize {
    PtySize {
        rows: window.rows,
        cols: window.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

// ---------------------------------------------------------------------------
// Entry-point bodies
// ---------------------------------------------------------------------------

/// Allocate a PTY, spawn the command as a session leader with a controlling TTY, and
/// register the session. Returns `{ session_id, pid, master_fd }` where `master_fd` is
/// a fresh dup handed wholly to Bun (FR8, C9, C11).
pub fn spawn(req: SpawnRequest) -> Result<Value, FfiError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(&req.window))
        .map_err(|e| io_error("openpty", e))?;

    let mut cmd = CommandBuilder::new(&req.command);
    cmd.args(&req.args);
    if let Some(cwd) = &req.cwd {
        cmd.cwd(cwd);
    }
    for entry in &req.env {
        cmd.env(&entry.name, &entry.value);
    }

    // `portable-pty`'s unix spawn runs `setsid` + `TIOCSCTTY` in the child, so the
    // child is a session leader with a controlling terminal (isatty == true) in its
    // own process group (pgid == pid) — the group `oc_pty_kill` signals (C11, C12).
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| io_error("spawn", e))?;
    // The parent no longer needs the slave fd; dropping it lets the master read EOF
    // once the child and all its descendants have closed the terminal.
    drop(pair.slave);

    let pid = child
        .process_id()
        .ok_or_else(|| FfiError::new(FfiErrorCode::IoError, "spawn produced no pid"))?
        as i32;
    // `setsid` guarantees the child leads its own group; use pid directly to avoid a
    // getpgid race against the child's not-yet-run pre_exec.
    let pgid = pid;

    let raw = pair
        .master
        .as_raw_fd()
        .ok_or_else(|| FfiError::new(FfiErrorCode::IoError, "master pty exposes no fd"))?;
    // Hand Bun its own fd (single-owner IO); Rust keeps the original only for resize.
    let master_fd = unsafe { libc::dup(raw) };
    if master_fd < 0 {
        return Err(io_error("dup master fd", std::io::Error::last_os_error()));
    }
    // Bun drives async IO on the event loop; the master fd must be non-blocking so
    // `node:net.Socket({ fd })` polls it via kqueue/epoll rather than blocking (C9).
    unsafe {
        let flags = libc::fcntl(master_fd, libc::F_GETFL);
        if flags >= 0 {
            libc::fcntl(master_fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }

    let session_id = mint_session_id();
    sessions().insert(
        session_id.clone(),
        Session {
            pid,
            pgid,
            master: pair.master,
            _child: child,
        },
    );

    Ok(serde_json::to_value(SpawnResult {
        session_id,
        pid,
        master_fd,
    })
    .expect("spawn result serializes"))
}

/// Apply a new terminal window size to a live session via `TIOCSWINSZ` (FR9, C12).
pub fn resize(req: ResizeRequest) -> Result<Value, FfiError> {
    let guard = sessions();
    let session = guard.get(&req.session_id).ok_or_else(not_found)?;
    session
        .master
        .resize(pty_size(&req.window))
        .map_err(|e| io_error("resize", e))?;
    Ok(Value::Null)
}

/// Deliver one signal to the child's process group (`killpg`), terminating the full
/// process tree with no orphans (FR9, NFR5, C11, C12). A group that has already exited
/// (`ESRCH`) is reported as success so kill is idempotent under a race.
pub fn kill(req: KillRequest) -> Result<Value, FfiError> {
    let pgid = sessions().get(&req.session_id).map(|s| s.pgid);
    let pgid = pgid.ok_or_else(not_found)?;
    let rc = unsafe { libc::killpg(pgid, req.signal) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(io_error("killpg", err));
        }
    }
    Ok(Value::Null)
}

/// Decode a `waitpid` status into `(exit_code, signal)` (C12).
fn decode_status(status: libc::c_int) -> (Option<i32>, Option<i32>) {
    if libc::WIFEXITED(status) {
        (Some(libc::WEXITSTATUS(status)), None)
    } else if libc::WIFSIGNALED(status) {
        (None, Some(libc::WTERMSIG(status)))
    } else {
        (None, None)
    }
}

/// Non-blocking `waitpid(WNOHANG)` for a session: reports whether the child has
/// terminated and, if so, its exit code or terminating signal (FR9, C12).
pub fn wait(req: WaitRequest) -> Result<Value, FfiError> {
    let pid = sessions().get(&req.session_id).map(|s| s.pid);
    let pid = pid.ok_or_else(not_found)?;

    let mut status: libc::c_int = 0;
    let rc = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
    let result = if rc == 0 {
        // The child is still running.
        WaitResult {
            exited: false,
            exit_code: None,
            signal: None,
        }
    } else if rc < 0 {
        // Already reaped (ECHILD) — report terminated without a decoded status.
        WaitResult {
            exited: true,
            exit_code: None,
            signal: None,
        }
    } else {
        let (exit_code, signal) = decode_status(status);
        WaitResult {
            exited: true,
            exit_code,
            signal,
        }
    };
    Ok(serde_json::to_value(result).expect("wait result serializes"))
}

/// Idempotent single-owner teardown: drop the session (closing Rust's retained master
/// fd) and best-effort reap the child so no zombie lingers. Bun independently closes
/// its own master-fd dup exactly once. Closing an unknown/already-closed session is a
/// success (FR9, C9, C10, C12).
pub fn close(req: CloseRequest) -> Result<Value, FfiError> {
    let removed = sessions().remove(&req.session_id);
    if let Some(session) = removed {
        // Reap if the child already exited; a still-running child is left to the
        // caller's prior kill+wait, and its handle drop does not signal it.
        let mut status: libc::c_int = 0;
        unsafe { libc::waitpid(session.pid, &mut status, libc::WNOHANG) };
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::io::RawFd;

    fn window() -> WindowSize {
        WindowSize { cols: 80, rows: 24 }
    }

    /// Close a Bun-owned dup fd the test received but does not stream, so the harness
    /// leaks no descriptors.
    fn drop_fd(fd: RawFd) {
        unsafe {
            libc::close(fd);
        }
    }

    fn spawn_ok(command: &str, args: &[&str]) -> SpawnResult {
        let req = SpawnRequest {
            command: command.to_string(),
            args: args.iter().map(|a| a.to_string()).collect(),
            cwd: None,
            env: vec![EnvEntry {
                name: "PATH".into(),
                value: "/usr/bin:/bin".into(),
            }],
            window: window(),
        };
        serde_json::from_value(spawn(req).unwrap()).unwrap()
    }

    fn wait_result(session_id: &str) -> WaitResult {
        serde_json::from_value(
            wait(WaitRequest {
                session_id: session_id.to_string(),
            })
            .unwrap(),
        )
        .unwrap()
    }

    /// Poll the non-blocking wait until the child exits or the bound elapses.
    fn wait_until_exit(session_id: &str) -> WaitResult {
        for _ in 0..2000 {
            let r = wait_result(session_id);
            if r.exited {
                return r;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        panic!("child did not exit within the bound");
    }

    #[test]
    fn spawn_returns_a_valid_triple_with_controlling_tty() {
        let out = spawn_ok("/bin/echo", &["hi"]);
        assert!(out.pid > 0, "pid must be positive");
        assert!(out.master_fd >= 0, "master fd must be a real descriptor");
        assert!(out.session_id.starts_with("pty-"));
        let exit = wait_until_exit(&out.session_id);
        assert!(exit.exited);
        assert_eq!(exit.exit_code, Some(0));
        drop_fd(out.master_fd);
        close(CloseRequest {
            session_id: out.session_id,
        })
        .unwrap();
    }

    #[test]
    fn spawned_command_observes_isatty_on_stdin() {
        // `test -t 0` exits 0 only when stdin is a terminal — proving the controlling
        // TTY is established (FR8, AC8).
        let out = spawn_ok("/bin/sh", &["-c", "test -t 0"]);
        let exit = wait_until_exit(&out.session_id);
        assert_eq!(exit.exit_code, Some(0), "stdin was not a tty");
        drop_fd(out.master_fd);
        close(CloseRequest {
            session_id: out.session_id,
        })
        .unwrap();
    }

    #[test]
    fn resize_applies_the_window_size() {
        let out = spawn_ok("/bin/sh", &["-c", "sleep 1"]);
        let res = resize(ResizeRequest {
            session_id: out.session_id.clone(),
            window: WindowSize {
                cols: 120,
                rows: 40,
            },
        });
        assert!(res.is_ok(), "resize failed: {res:?}");
        kill(KillRequest {
            session_id: out.session_id.clone(),
            signal: libc::SIGKILL,
        })
        .unwrap();
        wait_until_exit(&out.session_id);
        drop_fd(out.master_fd);
        close(CloseRequest {
            session_id: out.session_id,
        })
        .unwrap();
    }

    #[test]
    fn kill_targets_the_process_group_and_terminates_the_child() {
        let out = spawn_ok("/bin/sh", &["-c", "sleep 30"]);
        // Before the kill the child is still running.
        assert!(!wait_result(&out.session_id).exited);
        kill(KillRequest {
            session_id: out.session_id.clone(),
            signal: libc::SIGKILL,
        })
        .unwrap();
        let exit = wait_until_exit(&out.session_id);
        assert!(exit.exited);
        assert_eq!(exit.signal, Some(libc::SIGKILL));
        drop_fd(out.master_fd);
        close(CloseRequest {
            session_id: out.session_id,
        })
        .unwrap();
    }

    #[test]
    fn wait_is_non_blocking_before_exit() {
        let out = spawn_ok("/bin/sh", &["-c", "sleep 2"]);
        // A non-blocking wait returns immediately with `exited: false`.
        let start = std::time::Instant::now();
        let r = wait_result(&out.session_id);
        assert!(start.elapsed() < std::time::Duration::from_millis(500));
        assert!(!r.exited);
        kill(KillRequest {
            session_id: out.session_id.clone(),
            signal: libc::SIGKILL,
        })
        .unwrap();
        wait_until_exit(&out.session_id);
        drop_fd(out.master_fd);
        close(CloseRequest {
            session_id: out.session_id,
        })
        .unwrap();
    }

    #[test]
    fn close_is_idempotent() {
        let out = spawn_ok("/bin/echo", &["done"]);
        wait_until_exit(&out.session_id);
        drop_fd(out.master_fd);
        // Two closes in a row both succeed; the second targets an absent session.
        close(CloseRequest {
            session_id: out.session_id.clone(),
        })
        .unwrap();
        close(CloseRequest {
            session_id: out.session_id.clone(),
        })
        .unwrap();
    }

    #[test]
    fn operations_on_an_unknown_session_report_not_found() {
        let err = resize(ResizeRequest {
            session_id: "pty-does-not-exist".into(),
            window: window(),
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::NotFound);
        let err = kill(KillRequest {
            session_id: "pty-does-not-exist".into(),
            signal: libc::SIGTERM,
        })
        .unwrap_err();
        assert_eq!(err.code, FfiErrorCode::NotFound);
        // close of an unknown session is a success (idempotent teardown).
        close(CloseRequest {
            session_id: "pty-does-not-exist".into(),
        })
        .unwrap();
    }
}
