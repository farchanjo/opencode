// DDD role: ValueObject

package schemas

// #NativeToolBackend selects which implementation serves a built-in tool call.
// Native execution is optional; absence of the compiled library degrades to "typescript".
// DDD role: ValueObject
#NativeToolBackend: "native" | "typescript"

// #NativeToolName enumerates the six filesystem/text tools reimplemented natively.
// DDD role: ValueObject
#NativeToolName: "read" | "write" | "edit" | "apply_patch" | "glob" | "grep"

// #FfiStatus discriminates a native FFI response; errors are structured, never numeric codes.
// DDD role: ValueObject
#FfiStatus: "ok" | "error"

// #FfiError is the typed error payload returned when status is "error".
// DDD role: ValueObject
#FfiError: {
    code:    string & !=""
    message: string & !=""
}

// #FfiResponse is the JSON envelope every extern "C" entry point returns.
// A caught panic is mapped to status "error"; it never unwinds across the boundary.
// DDD role: ValueObject
#FfiResponse: {
    status: #FfiStatus
    if status == "ok" {
        result?: {...}
    }
    if status == "error" {
        error: #FfiError
    }
}

// #PtySession is the handle oc_pty_spawn returns; the master_fd is owned single-writer by Bun.
// DDD role: ValueObject
#PtySession: {
    session_id: string & !=""
    pid:        int & >0
    master_fd:  int & >=0
}
