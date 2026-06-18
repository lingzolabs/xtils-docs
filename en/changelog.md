# Changelog

All notable changes to xtils are documented here (reverse chronological order).

Format: `type(scope): description` — types: feat, fix, refactor, chore, tidy.

---

## v2.0.0 <Badge type="info" text="2026-06" />

Major release. Tagged after the v1.x deprecation grace period; all snake_case
wrappers and compat shims are gone.

### 💥 BREAKING CHANGES — deprecated APIs removed

| Header | Removed | Replacement |
|--------|---------|-------------|
| `xtils/app/app.h` | `App::registor`/`ins`/`run`/`run_daemon`/`init`/`is_running`/`spawn`/`spawn_async`/`every`/`delay`/`emit`/`connect`/`conf` | `App::Register/Ins/Run/RunDaemon/Init/IsRunning/Spawn/SpawnAsync/Every/Delay/Emit/Connect/Conf` |
| `xtils/app/service.h` | `Service::emit`, `xtils::isOk/init/shutdown/run_forever/run_daemon` | `Service::Emit`, `xtils::IsOk/Init/Shutdown/RunForever/RunDaemon` |
| `xtils/tasks/task_group.h` | `is_busy/size/stop/stop_wait_all/main_runner` | `IsBusy/Size/Stop/StopWaitAll/MainRunner` |
| `xtils/utils/thread_safe.h` | `pop_wait/try_pop/push/clear/size/quit` | `PopWait/TryPop/Push/Clear/Size/Quit` |
| `xtils/config/config_compat.h` | **entire file deleted** | Use PascalCase API (`Define`/`ParseArgs`/`LoadFile`/`ParseJson`/`Get`/`GetOr`, ...) |
| `xtils/fsm/fsm_compat.h` | **entire file deleted** | Use PascalCase API |
| `XTILS_ENABLE_DEPRECATED` macro | no longer recognised | Remove from your build system |

### 🌟 v2.0 highlights (cumulative since v1.2.1)

#### New modules

- **`xtils/metrics/`** — lightweight metrics primitives: `Counter`/`Gauge`/`Histogram` with labelled families and `PrometheusExporter` text rendering
- **`xtils/scripting/`** — embedded QuickJS-NG JavaScript engine, `ScriptEngine`/`ScriptContext`/`ScriptValue`, bidirectional `Json` ↔ `ScriptValue` conversion. Opt-in via `SCRIPTING_ENABLE=ON`
- **`xtils/net/ipc_channel.h`** — JSON-RPC 2.0 over filesystem Unix / abstract Unix / TCP sockets. `IpcServer` / `IpcClient` with sync call, async call, notifications and subscriptions
- **`xtils/net/http_client_pool.h`** — fixed-size HTTP client pool with RAII borrow handle and acquire timeout

#### Logging — structured logs

- **`xtils/logging/mdc.h`** — Mapped Diagnostic Context, thread-local key/value context auto-appended to structured output
- **`xtils/logging/log_builder.h`** — chained-field API: `LOGI().Field("req_id", id).Field("status", code).Msg("done");`
- Logging rewrite: atomic level checks (no mutex on hot path), `LogEntry` stores `const char*` literals (zero copy), raw `timespec` formatted lazily, new `Formatter` interface (`PlainFormatter`/`ColorFormatter`) per sink
- Assertion macros renamed to `XTILS_CHECK`/`XTILS_DCHECK`/`XTILS_FATAL` (opt-in short names via `XTILS_LOG_SHORT_MACROS`)

#### Net

- **HTTP type cleanup**: `HttpClient::Request`/`Response`/`Listener`/`MultipartField`/`MultipartFile` are now nested types; the synchronous entry point unifies into `HttpClient::Send()`. Server/router scoped names exposed as `HttpServer::Request`/`Connection`, `HttpRouter::Context`/`Response`. Old `HttpRequest`/`HttpResponse` public-header collisions removed
- **Router**: path parameters now support both Express-style `:param` and the existing `{param}` syntax
- **HttpServer**: new `HttpServerConfig` with configurable `max_payload_size` (default 4 MB) for memory-constrained devices
- **Multipart parsing**: `MultipartParser` plus lazy `GetMultipartFields()` / `GetMultipartFiles()` on the request context
- **File streaming**: `HttpServerConnection::SendFileStreaming()` chunked delivery (64 KB chunks)
- **WebSocket**: client owns its HTTP upgrade handshake directly — no more dependency on `HttpClient` / `HttpClientEventListener`. WSS supported
- **TLS backends**: `TLS_BACKEND=openssl|mbedtls` CMake option; backend-agnostic `tls_factory.h`
- **HttpClient**: single-flight start/cancel made explicit and atomic; timeout callbacks no longer touch destroyed clients

#### Tasks

- `TaskRunner` extensions: `PostDelayedTaskWithHandle` / `CancelDelayedTask`, `PostTaskAt(time_point)`, virtual `Now()` for fake-clock tests
- `CronScheduler::TaskInfo` gains `nextRun`; `triggerCheck()` locks the task map
- `TaskGroup` PascalCased; perf: tasks moved into / out of queues to avoid extra `std::function` copies

#### Config

- `Config::LoadEnv(prefix)` — import `<PREFIX>_<KEY>` env vars into dot-notation paths
- `Config::Short(name, alias)` — single-character short flag (e.g. `-p` for `--port`)
- `ConfigWatcher` (`xtils/config/config_watcher.h`) — inotify-based hot reload
- `GetOr<T>` two overloads: explicit fallback / Defined default

#### App / Service

- `IService::Dependencies()` virtual — declare service deps; App initialises in topological order, deinitialises in reverse
- Cycles or unknown dependencies abort early
- `App::TopoSortServices()` exposed for unit tests

#### Utils

- **`xtils/utils/crypto.h`** — SHA-256, HMAC-SHA1/256, secure RNG, UUID v4 (reuses the selected TLS backend; no new deps)
- **`xtils/utils/result.h`** — `Result<T,E>` gains `is_err()`, `unwrap_or_else()`, `expect()`. Error model documented at `docs/error-model.md` in the source repo
- JSON: zero-copy `find(key)`/`find(index)`, `Json::object()`/`Json::array()` factories; UTF-16 surrogate-pair fix; float round-trip precision (`%.17g`); `operator[]`/`push_back` type safety (only null may be promoted)

#### FSM / Behavior Tree

- FSM: `HistoryEntry` gains human-readable names, `DumpHistory()`, `RegisterEvent`/`GetEventName`. History is now a `deque`; `recursive_mutex`; `GetHistory()` returns by value; `SetRecordFailedEvents(bool)`
- BT: `SubTree` / `WaitForEvent` / `EventGuard` nodes; event queue (`sendEvent`/`peekEvent`/`consumeEvent`/`hasEvent`/`clearEvents`); `pause`/`resume`; `LoadTreesFromDirectory`; structured `BtLogger` (`BtFileLogger`/`BtInspectLogger`/`BtCompositeLogger`)

#### IPC (final v2.0 push)

- `IpcServer` / `IpcClient` reuse `UnixSocketRaw` and accept stream addresses beyond filesystem Unix sockets — abstract Unix and TCP IPv4/IPv6 also work
- `TaskGroup` is now the only IPC executor API; method/notification handlers dispatch through the server `TaskGroup` instead of running inline on per-client read threads
- Async calls no longer spawn one detached waiter thread each; callbacks complete from the read loop and are posted via the explicit / shared callback `TaskGroup`
- Pending callers and the read thread are correctly woken / joined when the peer disconnects before `Disconnect()`

#### Inspect

- Reimplementation: ~880 → ~330 lines
- Built-in two-pane web console (HTTP + WebSocket panels) embedded at build time via `cmake/embed_file.cmake`
- Handler signature: `void(const Request&, Response&)`
- New: `PublishWithResult`, `GetSubscriberCount`, `GetRoutes`, `HasRoute`

#### Notable fixes

- `string_utils`: rename misnamed parameter `xtils` back to `base` in every `Int*ToString` / `StringToInt*` overload
- `App::Run()`: replace broken heartbeat watchdog with proper monotonic deadline; accept `threads=1`
- `EventManager::Stop`: no longer shuts down a borrowed executor; default-constructed manager owns its own
- `UnixSocketRaw::Receive`/`Send` vs `Shutdown` race fixed with fd-validity check
- `HttpRouter`: per-request CORS reset on keep-alive; no dangling `Origin` string_view; no chunked trailer appended to response body

### Migration

| Item | How to migrate |
|------|---------------|
| All `*_compat.h` headers | Already removed — switch to PascalCase API |
| `XTILS_ENABLE_DEPRECATED` | Drop from CMake/build |
| `HttpRequest`/`HttpResponse` public types | Use `HttpRouter::Context`/`Response` (router) or `HttpClient::Request`/`Response` (client) |
| `HttpClient::Request*` sync entry points | Use `HttpClient::Send()` |
| `WebSocketClient` HttpClient dependency | No longer needed; client handles upgrade itself |
| `IpcServer/IpcClient` `TaskRunner*` ctor | Pass `TaskGroup&` (or rely on default shared `TaskGroup`) |

---

## v1.1.0 <Badge type="info" text="2025-10-16" />

First official tag. Includes all foundational modules built since project inception.

### Module overview

| Module | Status |
|--------|--------|
| App framework | ✅ service lifecycle, events, timers |
| Config | ✅ JSON config + CLI parsing |
| Logging | ✅ async logger, console/file sinks, watchdog |
| Net | ✅ TCP/UDP client/server, HTTP client/server, WebSocket client |
| FSM | ✅ state machine + history + Graphviz export |
| Tasks | ✅ event loop, thread pool, TaskGroup, timer, CronScheduler |
| Debug | ✅ Inspect HTTP/WS debug server, Chrome Tracer |
| Utils | ✅ JSON, strings, files, base64, SHA1, byte reader/writer |

### Highlights

- **App framework**: singleton context, `Service<T>` CRTP base, automatic config-section injection
- **Event loop**: epoll-backed `UnixTaskRunner`, `ThreadTaskRunner` dedicated-thread wrapper
- **Networking**: full TCP/UDP/HTTP/WebSocket stack, Express-style router, CORS, middleware
- **Logging**: printf-style macros, async ring buffer, size-rotated file sink, memory/CPU watchdog
- **FSM**: named states, event transitions, guards, history, DOT graph export
- **CronScheduler**: cron expressions + interval scheduling
- **Custom JSON**: zero-dependency, replaces nlohmann_json
- **Inspect**: runtime HTTP/WebSocket debug server, fully strippable at compile time
- **Tracer**: Chrome trace format profiling with RAII macros
- **Build**: single-static-library CMake target, automatic C++17 propagation, GitHub Actions CI

---

## Project bootstrapping (2025-06 ~ 2025-09)

Initial phase, gradually building out core modules:

- 2025-06: HTTP / WebSocket server prototypes, JSON impl, Config class
- 2025-07: Inspect debug server, Tracer, WeakPtr, platform abstraction
- 2025-08: file utils, byte reader/writer, Service framework
- 2025-09: FSM debug enhancements, full HTTP/TCP/UDP impl
