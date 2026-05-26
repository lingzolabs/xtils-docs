# Introduction

## What is xtils?

**xtils** is a C++17 static utility library that provides a comprehensive toolkit for building robust applications. Rather than pulling in dozens of separate dependencies, xtils gives you a cohesive set of modules that work together seamlessly — from application lifecycle management and configuration to networking, state machines, and async task scheduling.

## Why xtils?

Building a C++ application typically involves stitching together many libraries: one for HTTP, another for logging, yet another for JSON, timers, thread pools, etc. Each has different conventions, build systems, and API styles. xtils solves this by providing:

- **A unified API surface** — PascalCase methods, consistent error handling, and shared conventions across all modules
- **Zero friction integration** — Single static library, one `target_link_libraries` call, automatic C++17 propagation
- **Minimal external dependencies** — Only a TLS backend (OpenSSL or mbedTLS) is required; everything else is self-contained
- **Production-ready primitives** — Battle-tested networking, async I/O, and state machine implementations

## Design Principles

### Cohesion Over Collection

xtils modules are designed to work together. The App framework owns the event loop that powers networking. The TaskRunner interface is shared between timers, HTTP servers, and WebSocket clients. The Config module integrates with the App lifecycle. This means less glue code and fewer surprises.

### Explicit Over Implicit

APIs are straightforward and predictable:
- No global state beyond the App singleton (which is opt-in)
- No hidden threads — you control where work happens via TaskRunner
- No implicit allocations — memory ownership is clear through `std::unique_ptr` and `std::shared_ptr`

### C++17, Not C++23

xtils targets C++17 to maximize compatibility while still leveraging modern features:
- `std::optional` for nullable returns
- `std::string_view` for zero-copy string passing
- `std::variant` and `if constexpr` internally
- Structured bindings and fold expressions where beneficial

## Module Overview

| Module | Header Prefix | What It Does |
|--------|--------------|--------------|
| [App](/en/modules/app) | `xtils/app/` | Application lifecycle, service registration, events, timers |
| [Config](/en/modules/config) | `xtils/config/` | JSON-backed configuration with CLI parsing and dot-notation paths |
| [FSM](/en/modules/fsm) | `xtils/fsm/` | Finite state machines with guards, actions, history, Graphviz export |
| [Behavior Tree](/en/modules/behavior-tree) | `xtils/fsm/` | JSON-driven behavior trees with blackboard, ports, subtrees |
| [Logging](/en/modules/logging) | `xtils/logging/` | Async logger with rotating file sinks and system watchdog |
| [Networking](/en/modules/networking) | `xtils/net/` | TCP/UDP, HTTP client & server, WebSocket, TLS, routing |
| [Tasks](/en/modules/tasks) | `xtils/tasks/` | Event loops, thread pools, task groups, timers, cron scheduler |
| [Utils](/en/modules/utils) | `xtils/utils/` | JSON, string ops, file I/O, base64, byte reader/writer, RAII |
| [Debug](/en/modules/debug) | `xtils/debug/` | HTTP/WS debug server (Inspect), Chrome trace format (Tracer) |

## Quick Example

Here's a minimal application using the App framework with a timer and logging:

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class MyService : public Service<MyService> {
 public:
  MyService() : Service<MyService>("my_service") {}

  void Init() override {
    LogI("[MyService] Initialized!");
    
    // Fire a repeating timer every 1 second
    ctx->Every(1000, [this]() {
      LogD("[MyService] Tick!");
    });

    // Schedule a one-shot delayed task
    ctx->Delay(5000, [this]() {
      LogI("[MyService] 5 seconds elapsed, shutting down...");
      ctx->Shutdown();
    });
  }

  void Deinit() override {
    LogI("[MyService] Shutting down gracefully");
  }
};

void app_main(App& app, const std::vector<std::string>& args) {
  app.Register(std::make_shared<MyService>());
}
```

## Next Steps

- **[Getting Started](/en/guide/getting-started)** — Clone, build, and link xtils in your project
- **[Architecture](/en/guide/architecture)** — Understand the module dependency graph and build system
- **[App Framework](/en/modules/app)** — Deep dive into the application lifecycle
