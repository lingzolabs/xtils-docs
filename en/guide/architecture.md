# Architecture

## Module Dependency Graph

xtils modules are layered. Lower-level modules have no upward dependencies:

![Module Dependency Layers](/images/module-layers.svg)

**Key relationships:**
- `net` depends on `tasks` (for event loops) and `system` (for sockets)
- `fsm` depends only on `utils` (json, type_traits)
- `app` orchestrates everything: owns the event loop, thread pool, and service lifecycle
- `debug/inspect` uses `net` to serve a debug HTTP/WebSocket interface

## Directory Layout

```
xtils/
├── include/xtils/              # Public headers (your #include path)
│   ├── app/                    # app.h, service.h, auto-gen.h
│   ├── config/                 # config.h, config_watcher.h
│   ├── debug/                  # inspect.h, tracer.h
│   ├── fsm/                    # fsm.h, behavior_tree.h, bt_*logger.h
│   ├── logging/                # logger.h, sink.h, mdc.h, log_builder.h, watchdog.h
│   ├── metrics/                # metrics.h (Counter/Gauge/Histogram + Prometheus)
│   ├── net/                    # Networking
│   │   ├── transport/          # transport.h, tls_transport.h, tls_factory.h, ...
│   │   ├── http_client.h / http_server.h / http_router.h
│   │   ├── http_client_pool.h  # HttpClientPool
│   │   ├── http_multipart.h    # multipart/form-data parser
│   │   ├── ipc_channel.h       # JSON-RPC 2.0 IPC
│   │   ├── tcp_client.h / tcp_server.h
│   │   ├── udp_client.h / udp_server.h
│   │   └── websocket_client.h / websocket_common.h
│   ├── scripting/              # Optional QuickJS-NG embedding
│   ├── system/                 # OS abstractions
│   ├── tasks/                  # Async & scheduling
│   └── utils/                  # General utilities (json/crypto/result/...)
├── src/                        # Implementation (.cc files)
├── tests/                      # Unit tests (doctest)
├── examples/                   # Built-in examples
├── cmake/                      # CMake helpers
└── docs/                       # Source documentation
```

## Event Loop Architecture

The heart of xtils is the **event loop** built on Linux `epoll` (with `poll` fallback):

```
┌──────────────────────────────────────────┐
│              UnixTaskRunner               │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────┐  │
│  │  epoll   │  │  timers  │  │ tasks │  │
│  │  (I/O)   │  │  (heap)  │  │(queue)│  │
│  └──────────┘  └──────────┘  └───────┘  │
│        │             │            │      │
│        └─────────────┴────────────┘      │
│                     │                    │
│              event loop tick             │
└──────────────────────────────────────────┘
```

- **I/O watches**: File descriptors (sockets, eventfds) trigger callbacks when readable
- **Timers**: Sorted by deadline; fired during each loop iteration
- **Task queue**: Posted work items executed in order

`ThreadTaskRunner` wraps a `UnixTaskRunner` on a dedicated thread, providing thread-safe `PostTask`/`PostDelayedTask`.

## Service Lifecycle

```
App::Init()
  │
  ├─ Create thread pool (TaskGroup)
  ├─ Create event loop (UnixTaskRunner)
  ├─ Load config file
  ├─ For each registered service:
  │    ├─ Inject App* context
  │    ├─ Inject service-specific config section
  │    └─ Call service.Init()
  │
  └─ App::Run() — blocks on event loop

App::Shutdown()
  │
  ├─ For each service (reverse order):
  │    └─ Call service.Deinit()    ← infrastructure still alive here!
  ├─ Stop thread pool
  └─ Stop event loop
```

::: warning Important
`Deinit()` is called **before** infrastructure shutdown. This means services can still use the event loop, timers, and thread pool during cleanup (e.g., WebSocket close handshake, flushing pending I/O).
:::

## Thread Model

xtils uses a **single main thread + worker pool** model:

| Thread | Role | Access Pattern |
|--------|------|----------------|
| Main thread | Event loop, I/O callbacks, timer callbacks | All `net` callbacks fire here |
| Worker threads | `SpawnAsync` tasks, CPU-bound work | Via `TaskGroup` |
| Service threads | `ThreadTaskRunner` instances | Created by services as needed |

::: tip
Network callbacks always fire on the main event loop thread. Use `Spawn()` to post results back to main thread, or `SpawnAsync()` for offloading heavy work.
:::

## TLS Architecture

```
                    Consumer code
                         │
                         ▼
              ┌─────────────────────┐
              │    tls_factory.h    │  ← Backend-agnostic API
              └─────────────────────┘
                    │           │
         ┌─────────┘           └──────────┐
         ▼                                ▼
┌─────────────────┐            ┌─────────────────┐
│  OpenSSL backend│            │  mbedTLS backend │
│  tls_transport  │            │ mbedtls_transport│
└─────────────────┘            └─────────────────┘
```

Both backends implement the same `Transport` interface. Selection is compile-time via `TLS_BACKEND` CMake option.

## Build System Details

### Compile Definitions Propagated to Consumers

| Definition | When |
|-----------|------|
| `USE_OPENSSL` | `TLS_BACKEND=openssl` |
| `USE_MBEDTLS` | `TLS_BACKEND=mbedtls` |
| `INSPECT_DISABLE` | `INSPECT_DISABLE=ON` |
| `XTILS_HAS_SCRIPTING` | `SCRIPTING_ENABLE=ON` |
| `ENABLE_TRACE_RECORDING` | defined to enable Tracer macros |
| `ENABLE_TRACE_LOGGING` | defined to enable `LogT()` / trace level |

### Exported CMake Targets

- `xtils` — The main static library (includes all modules)
- Transitively links: pthread, TLS backend libs

### Source Organization

Each module has a matching `src/<module>/` directory. Implementation files are `.cc`, one file per class/component typically.
