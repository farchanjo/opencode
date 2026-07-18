/**
 * Darwin Security.framework backend via Bun.dlopen + bun:ffi (T019).
 *
 * Old Keychain Services APIs:
 * - SecKeychainAddGenericPassword / FindGenericPassword
 * - SecKeychainItemModifyAttributesAndData / ItemDelete / ItemFreeContent
 * - CFRelease (CoreFoundation) for item refs from Find
 *
 * Pointer out-params use Bun `ptr` + `read.ptr` / u32 length holders (not bigint cast-as-never).
 * passwordLength bounds-checked before toArrayBuffer (H2).
 * Attributes-only find passes null password outs (M2).
 * CFRelease itemRef always in finally after delete (M1) — Find returns +1 CF retain;
 * SecKeychainItemDelete does not consume that retain (Apple Keychain Services).
 *
 * Tests inject mock symbols / PointerIO only — never real Sec* ops.
 */
import {
  assertKeychainFieldBounds,
  createDarwinKeychainBackend,
  createUnavailableKeychainBackend,
  mapOsStatus,
  MAX_SECRET_MATERIAL_BYTES,
  OSSTATUS,
  type DarwinSecurityFfi,
  type KeychainBackend,
} from "./keychain-backend"

const SECURITY_FRAMEWORK = "/System/Library/Frameworks/Security.framework/Security"
const CORE_FOUNDATION = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"

/** Opaque native pointer value from Bun read.ptr / injectable tests. */
export type NativePtr = number | bigint | object

export type PointerIO = {
  /** Point to a typed array for FFI args. */
  readonly asPtr: (view: ArrayBufferView) => unknown
  /** Allocate u32 out-holder for passwordLength. */
  readonly allocU32: () => { readonly view: Uint32Array; readonly read: () => number }
  /**
   * Allocate pointer-sized out-holder; read via documented Bun read.ptr pattern.
   * Returns null when pointer is null/zero.
   */
  readonly allocOutPtr: () => { readonly view: ArrayBufferView; readonly read: () => NativePtr | null }
  /** Copy `length` bytes from native address into a fresh Uint8Array. */
  readonly copyBytes: (address: NativePtr, length: number) => Uint8Array
}

type BunFfiMod = {
  ptr: (value: ArrayBufferView | ArrayBuffer) => unknown
  toArrayBuffer: (ptr: unknown, byteOffset: number, byteLength: number) => ArrayBuffer
  read: {
    ptr: (ptr: unknown, byteOffset?: number) => unknown
    u32: (ptr: unknown, byteOffset?: number) => number
  }
}

function loadBunFfiMod(): BunFfiMod | null {
  try {
    return require("bun:ffi") as BunFfiMod
  } catch {
    return null
  }
}

/**
 * Production PointerIO using Bun FFI documented read.ptr / ptr / toArrayBuffer only.
 * Fail closed: if read.ptr throws or returns null/0 → null (caller maps secret_backend).
 * No bigint view[0] fallback (avoids PAC truncation / non-documented pointer reads).
 */
export function createBunPointerIO(mod?: BunFfiMod | null): PointerIO | null {
  const ffi = mod ?? loadBunFfiMod()
  if (!ffi?.ptr || !ffi?.toArrayBuffer || !ffi?.read?.ptr) return null

  return {
    asPtr(view) {
      return ffi.ptr(view)
    },
    allocU32() {
      const view = new Uint32Array(1)
      return {
        view,
        read: () => view[0] ?? 0,
      }
    },
    allocOutPtr() {
      // Pointer-sized out storage; ONLY read via read.ptr(ptr(view), 0)
      const view = new BigUint64Array(1)
      return {
        view,
        read: () => {
          try {
            const p = ffi.read.ptr(ffi.ptr(view), 0)
            if (p === null || p === undefined || p === 0 || p === 0n) return null
            return p as NativePtr
          } catch {
            // Fail closed — no bigint cast fallback
            return null
          }
        },
      }
    },
    copyBytes(address, length) {
      const ab = ffi.toArrayBuffer(address as never, 0, length)
      return new Uint8Array(ab.slice(0))
    },
  }
}

/**
 * Injectable mock PointerIO for high-address / read abstraction tests (no real FFI).
 */
export function createMockPointerIO(options?: {
  readonly highAddress?: NativePtr
}): PointerIO & { readonly lastReadAddresses: NativePtr[] } {
  const lastReadAddresses: NativePtr[] = []
  const store = new Map<string, number | bigint>()
  let seq = 1n
  return {
    lastReadAddresses,
    asPtr(view) {
      return view
    },
    allocU32() {
      const view = new Uint32Array(1)
      return { view, read: () => view[0] ?? 0 }
    },
    allocOutPtr() {
      const id = seq++
      const view = new BigUint64Array(1)
      view[0] = id
      return {
        view,
        read: () => {
          const written = store.get(String(id))
          if (written !== undefined) {
            lastReadAddresses.push(written as NativePtr)
            return written as NativePtr
          }
          if (options?.highAddress !== undefined) {
            lastReadAddresses.push(options.highAddress)
            return options.highAddress
          }
          const v = view[0]
          if (!v || v === 0n) return null
          return v
        },
      }
    },
    copyBytes(_address, length) {
      return new Uint8Array(length)
    },
  }
}

export type DarwinSecuritySymbols = {
  readonly SecKeychainAddGenericPassword: (
    keychain: null,
    serviceLength: number,
    serviceName: unknown,
    accountLength: number,
    accountName: unknown,
    passwordLength: number,
    passwordData: unknown,
    itemRef: unknown,
  ) => number
  readonly SecKeychainFindGenericPassword: (
    keychain: null,
    serviceLength: number,
    serviceName: unknown,
    accountLength: number,
    accountName: unknown,
    passwordLength: unknown,
    passwordData: unknown,
    itemRef: unknown,
  ) => number
  readonly SecKeychainItemModifyAttributesAndData: (
    itemRef: unknown,
    attrList: null,
    length: number,
    data: unknown,
  ) => number
  readonly SecKeychainItemDelete: (itemRef: unknown) => number
  readonly SecKeychainItemFreeContent: (attrList: null, data: unknown) => number
  readonly CFRelease: (cf: unknown) => void
}

/**
 * dlopen + symbol presence only. Does NOT invoke any SecKeychain or CFRelease ops.
 */
export function loadDarwinSecuritySymbols(): DarwinSecuritySymbols | null {
  if (process.platform !== "darwin") return null
  const ffi = loadBunFfiMod()
  if (!ffi) return null
  try {
    const security = (require("bun:ffi") as { dlopen: typeof import("bun:ffi").dlopen }).dlopen(
      SECURITY_FRAMEWORK,
      {
        SecKeychainAddGenericPassword: {
          args: ["ptr", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"],
          returns: "i32",
        },
        SecKeychainFindGenericPassword: {
          args: ["ptr", "u32", "ptr", "u32", "ptr", "ptr", "ptr", "ptr"],
          returns: "i32",
        },
        SecKeychainItemModifyAttributesAndData: {
          args: ["ptr", "ptr", "u32", "ptr"],
          returns: "i32",
        },
        SecKeychainItemDelete: { args: ["ptr"], returns: "i32" },
        SecKeychainItemFreeContent: { args: ["ptr", "ptr"], returns: "i32" },
      },
    )
    const cf = (require("bun:ffi") as { dlopen: typeof import("bun:ffi").dlopen }).dlopen(CORE_FOUNDATION, {
      CFRelease: { args: ["ptr"], returns: "void" },
    })

    const add = security.symbols.SecKeychainAddGenericPassword
    const find = security.symbols.SecKeychainFindGenericPassword
    const modify = security.symbols.SecKeychainItemModifyAttributesAndData
    const del = security.symbols.SecKeychainItemDelete
    const freeContent = security.symbols.SecKeychainItemFreeContent
    const release = cf.symbols.CFRelease
    if (!add || !find || !modify || !del || !freeContent || !release) return null

    return {
      SecKeychainAddGenericPassword: add as DarwinSecuritySymbols["SecKeychainAddGenericPassword"],
      SecKeychainFindGenericPassword: find as DarwinSecuritySymbols["SecKeychainFindGenericPassword"],
      SecKeychainItemModifyAttributesAndData:
        modify as DarwinSecuritySymbols["SecKeychainItemModifyAttributesAndData"],
      SecKeychainItemDelete: del as DarwinSecuritySymbols["SecKeychainItemDelete"],
      SecKeychainItemFreeContent: freeContent as DarwinSecuritySymbols["SecKeychainItemFreeContent"],
      CFRelease: release as DarwinSecuritySymbols["CFRelease"],
    }
  } catch {
    return null
  }
}

/**
 * Build high-level DarwinSecurityFfi from raw symbols + PointerIO.
 */
export function createDarwinSecurityFfiFromSymbols(
  symbols: DarwinSecuritySymbols,
  options?: { readonly pointerIO?: PointerIO },
): DarwinSecurityFfi {
  const pointerIO = options?.pointerIO ?? createBunPointerIO()
  if (!pointerIO) throw new Error("bun:ffi PointerIO unavailable")
  const io: PointerIO = pointerIO

  const enc = new TextEncoder()
  let ops = 0

  function encodeField(value: string): Uint8Array {
    return enc.encode(value)
  }

  function freePasswordData(dataPtr: NativePtr | null) {
    if (dataPtr === null || dataPtr === 0 || dataPtr === 0n) return
    try {
      symbols.SecKeychainItemFreeContent(null, dataPtr as never)
    } catch {
      // never throw secret paths
    }
  }

  /**
   * CFRelease item ref from SecKeychainFindGenericPassword.
   * Find returns a +1 retain; SecKeychainItemDelete does not consume it — always release.
   * @see Apple Keychain Services: SecKeychainFindGenericPassword / CFRelease
   */
  function releaseItem(itemRef: NativePtr | null) {
    if (itemRef === null || itemRef === 0 || itemRef === 0n) return
    try {
      symbols.CFRelease(itemRef as never)
    } catch {
      // ignore
    }
  }

  function findWithMaterial(service: string, account: string): {
    code: number
    passwordLength: number
    passwordData: NativePtr | null
    itemRef: NativePtr | null
  } {
    const s = encodeField(service)
    const a = encodeField(account)
    const lenOut = io.allocU32()
    const dataOut = io.allocOutPtr()
    const itemOut = io.allocOutPtr()
    const code = symbols.SecKeychainFindGenericPassword(
      null,
      s.byteLength,
      io.asPtr(s),
      a.byteLength,
      io.asPtr(a),
      io.asPtr(lenOut.view),
      io.asPtr(dataOut.view),
      io.asPtr(itemOut.view),
    )
    return {
      code,
      passwordLength: lenOut.read(),
      passwordData: dataOut.read(),
      itemRef: itemOut.read(),
    }
  }

  /**
   * Attributes-only: null passwordLength and passwordData out-params — no material.
   */
  function findAttributesOnly(service: string, account: string): {
    code: number
    itemRef: NativePtr | null
  } {
    const s = encodeField(service)
    const a = encodeField(account)
    const itemOut = io.allocOutPtr()
    const code = symbols.SecKeychainFindGenericPassword(
      null,
      s.byteLength,
      io.asPtr(s),
      a.byteLength,
      io.asPtr(a),
      null, // passwordLength
      null, // passwordData — no material
      io.asPtr(itemOut.view),
    )
    return { code, itemRef: itemOut.read() }
  }

  return {
    opCount: () => ops,

    addGenericPassword(service, account, secret) {
      ops += 1
      const bound = assertKeychainFieldBounds({
        service,
        account,
        secretBytes: secret.byteLength,
      })
      if (bound) return OSSTATUS.errSecParam
      const s = encodeField(service)
      const a = encodeField(account)
      return symbols.SecKeychainAddGenericPassword(
        null,
        s.byteLength,
        io.asPtr(s),
        a.byteLength,
        io.asPtr(a),
        secret.byteLength,
        io.asPtr(secret),
        null,
      )
    },

    findGenericPassword(service, account) {
      ops += 1
      const bound = assertKeychainFieldBounds({ service, account })
      if (bound) return null
      const found = findWithMaterial(service, account)
      if (found.code === OSSTATUS.errSecItemNotFound) {
        freePasswordData(found.passwordData)
        releaseItem(found.itemRef)
        return null
      }
      if (found.code !== OSSTATUS.errSecSuccess) {
        freePasswordData(found.passwordData)
        releaseItem(found.itemRef)
        if (found.code === OSSTATUS.errSecAuthFailed) {
          throw new Error(mapOsStatus(found.code).reason)
        }
        return null
      }

      let copy: Uint8Array | null = null
      try {
        // H2: bounds BEFORE toArrayBuffer / copyBytes
        if (found.passwordLength <= 0 || found.passwordLength > MAX_SECRET_MATERIAL_BYTES) {
          throw new Error(
            mapOsStatus(OSSTATUS.errSecParam).reason + " (password length out of bounds)",
          )
        }
        if (found.passwordData === null) {
          throw new Error(mapOsStatus(OSSTATUS.errSecParam).reason)
        }
        copy = io.copyBytes(found.passwordData, found.passwordLength)
        return copy
      } finally {
        freePasswordData(found.passwordData)
        releaseItem(found.itemRef)
      }
    },

    existsGenericPassword(service, account) {
      ops += 1
      const bound = assertKeychainFieldBounds({ service, account })
      if (bound) return false
      const found = findAttributesOnly(service, account)
      try {
        if (found.code === OSSTATUS.errSecItemNotFound) return false
        if (found.code === OSSTATUS.errSecAuthFailed) {
          throw new Error(mapOsStatus(found.code).reason)
        }
        if (found.code !== OSSTATUS.errSecSuccess) {
          throw new Error(mapOsStatus(found.code).reason)
        }
        return true
      } finally {
        // M1: always CFRelease item ref from Find
        releaseItem(found.itemRef)
      }
    },

    updateGenericPassword(service, account, secret) {
      ops += 1
      const bound = assertKeychainFieldBounds({
        service,
        account,
        secretBytes: secret.byteLength,
      })
      if (bound) return OSSTATUS.errSecParam
      // Attributes-only find for item ref (no material)
      const found = findAttributesOnly(service, account)
      try {
        if (found.code === OSSTATUS.errSecItemNotFound) return OSSTATUS.errSecItemNotFound
        if (found.code !== OSSTATUS.errSecSuccess) return found.code
        if (found.itemRef === null) return OSSTATUS.errSecParam
        return symbols.SecKeychainItemModifyAttributesAndData(
          found.itemRef as never,
          null,
          secret.byteLength,
          io.asPtr(secret),
        )
      } finally {
        releaseItem(found.itemRef)
      }
    },

    deleteGenericPassword(service, account) {
      ops += 1
      const bound = assertKeychainFieldBounds({ service, account })
      if (bound) return OSSTATUS.errSecParam
      const found = findAttributesOnly(service, account)
      try {
        if (found.code === OSSTATUS.errSecItemNotFound) return OSSTATUS.errSecItemNotFound
        if (found.code !== OSSTATUS.errSecSuccess) return found.code
        if (found.itemRef === null) return OSSTATUS.errSecParam
        return symbols.SecKeychainItemDelete(found.itemRef as never)
      } finally {
        // M1: CFRelease after delete success OR failure (Find retain not consumed by Delete)
        releaseItem(found.itemRef)
      }
    },
  }
}

export function tryLoadDarwinSecurityFfi(): DarwinSecurityFfi | null {
  const symbols = loadDarwinSecuritySymbols()
  if (!symbols) return null
  try {
    return createDarwinSecurityFfiFromSymbols(symbols)
  } catch {
    return null
  }
}

export function createDarwinNativeKeychainBackend(options?: {
  readonly sandbox?: boolean
  readonly ffi?: DarwinSecurityFfi | null
  readonly symbols?: DarwinSecuritySymbols | null
  readonly pointerIO?: PointerIO
  readonly disableDlopen?: boolean
  readonly platform?: string
}): KeychainBackend {
  if (options?.sandbox) {
    return createUnavailableKeychainBackend("keychain disabled under operator sandbox")
  }
  const platform = options?.platform ?? process.platform
  if (platform !== "darwin") {
    return createUnavailableKeychainBackend("os keychain unavailable on this platform")
  }

  let ffi: DarwinSecurityFfi | null = null
  if (options?.ffi !== undefined) {
    ffi = options.ffi
  } else if (options?.symbols) {
    try {
      ffi = createDarwinSecurityFfiFromSymbols(options.symbols, { pointerIO: options.pointerIO })
    } catch {
      ffi = null
    }
  } else if (!options?.disableDlopen) {
    ffi = tryLoadDarwinSecurityFfi()
  }

  if (!ffi) {
    return createUnavailableKeychainBackend("Security.framework unavailable or failed to load")
  }
  return createDarwinKeychainBackend(ffi)
}

export function probeDarwinSecuritySymbolsPresent(): boolean {
  if (process.platform !== "darwin") return false
  try {
    return loadDarwinSecuritySymbols() !== null
  } catch {
    return false
  }
}

export { mapOsStatus, OSSTATUS }

export * as KeychainDarwin from "./keychain-darwin"
