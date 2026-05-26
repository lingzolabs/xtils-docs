# Debug

The Debug module provides two complementary tools for runtime introspection:

- **Inspect** — An HTTP/WebSocket debug server for live monitoring and control
- **Tracer** — A Chrome trace format profiler for performance analysis

Both can be completely stripped at compile time with `INSPECT_DISABLE=ON` and by not defining `ENABLE_TRACE_RECORDING`.

## Inspect — HTTP/WebSocket Debug Server

Inspect provides a built-in HTTP server for exposing internal state, metrics, and controls at runtime. It supports REST-style routes and WebSocket pub/sub for real-time data streaming.

### Header

```cpp
#include "xtils/debug/inspect.h"
```

### Initialization

```cpp
auto& inspect = Inspect::Get();  // Singleton
inspect.Init("127.0.0.1", 8080);

// Later...
inspect.Stop();
bool running = inspect.IsRunning();
```

### Registering Routes

```cpp
// Simple route
inspect.Route("/debug/config", [](const auto& req) {
  return Inspect::Json(app_config.ToJson());
});

// Route with description (shown in built-in index page)
inspect.Route("/debug/stats", "Application statistics", [](const auto& req) {
  Json stats;
  stats["uptime_s"] = GetUptime();
  stats["requests"] = request_count;
  stats["errors"] = error_count;
  return Inspect::Json(stats);
});

// Static content (e.g., embedded HTML dashboard)
inspect.Static("/debug/dashboard", dashboard_html, "text/html");

// Remove a route
inspect.Unregister("/debug/old_route");
```

### Response Helpers

```cpp
static Inspect::Response Json(const xtils::Json& json);
static Inspect::Response Text(const std::string& text);
static Inspect::Response Html(const std::string& html);
static Inspect::Response Error(const std::string& message);
static Inspect::Response Success(const std::string& message = "OK");
```

### WebSocket Pub/Sub

Register WebSocket endpoints and publish data to all subscribers:

```cpp
// Register a WebSocket endpoint
inspect.WebSocket("/debug/metrics", "Live metrics stream", [](const auto& req) {
  return Inspect::Success();  // Accept connection
});

// Publish to all connected WebSocket clients
Json metrics;
metrics["cpu"] = cpu_percent;
metrics["memory_mb"] = memory_mb;
inspect.Publish("/debug/metrics", metrics);

// Binary publish
inspect.Publish("/debug/binary", binary_data, /*is_text=*/false);

// Check if anyone is listening (avoid expensive serialization)
if (inspect.HasSubscribers("/debug/metrics")) {
  auto data = CollectDetailedMetrics();
  inspect.Publish("/debug/metrics", data.dump());
}
```

### Macros (Zero-Cost When Disabled)

These macros compile to nothing when `INSPECT_DISABLE` is defined:

```cpp
// Route registration
INSPECT_ROUTE("/debug/fsm", "FSM state", [&](const auto& req) {
  return Inspect::Json(fsm.ToJson());
});

// WebSocket
INSPECT_WEBSOCKET("/debug/events", "Live events", [](const auto& req) {
  return Inspect::Success();
});

// Static content
INSPECT_STATIC("/debug/ui", ui_html, "text/html");

// Convenience: serve a Json expression
INSPECT_JSON("/debug/state", state.ToJson());

// Convenience: serve a text expression
INSPECT_TEXT("/debug/version", GetVersion());

// Publish
INSPECT_PUBLISH("/debug/events", event_json.dump());
INSPECT_PUBLISH_BIN("/debug/binary", binary_data);
```

### Use Case: Live Dashboard

```cpp
class MonitorService : public Service<MonitorService> {
 public:
  MonitorService() : Service("monitor") {}

  void Init() override {
    // Register debug endpoints
    INSPECT_ROUTE("/debug/services", "Registered services", [this](const auto&) {
      return Inspect::Json(GetServiceList());
    });

    INSPECT_WEBSOCKET("/debug/live", "Real-time metrics", [](const auto&) {
      return Inspect::Success();
    });

    // Push metrics every second
    ctx->Every(1000, [this]() {
      if (!Inspect::Get().HasSubscribers("/debug/live")) return;
      
      Json m;
      m["timestamp"] = SteadyTimer::GetCurrentTimestampMs();
      m["connections"] = GetConnectionCount();
      m["throughput"] = GetThroughput();
      INSPECT_PUBLISH("/debug/live", m.dump());
    });
  }
};
```

## Tracer — Chrome Trace Format

The Tracer records scoped events in Chrome's trace format, viewable in `chrome://tracing` or [Perfetto UI](https://ui.perfetto.dev/).

### Header

```cpp
#include "xtils/debug/tracer.h"
```

### Enabling

The tracer is opt-in at compile time:

```cpp
#define ENABLE_TRACE_RECORDING  // Must be before #include
#include "xtils/debug/tracer.h"
```

Without `ENABLE_TRACE_RECORDING`, all trace macros compile to nothing.

### Macros

```cpp
// Scoped event (RAII — records duration from creation to scope exit)
TRACE_SCOPE("ProcessFrame")

// Instant event (point-in-time marker)
TRACE_INSTANT("FrameReady")

// Get trace data as string pointer
TRACE_DATA(string_ptr)

// Save trace to file
TRACE_SAVE("trace.json")
```

### Example: Profiling a Frame Loop

```cpp
#define ENABLE_TRACE_RECORDING
#include <xtils/debug/tracer.h>

void GameLoop() {
  while (running) {
    TRACE_SCOPE("Frame");

    {
      TRACE_SCOPE("Input");
      ProcessInput();
    }

    {
      TRACE_SCOPE("Physics");
      UpdatePhysics();
      TRACE_INSTANT("PhysicsComplete");
    }

    {
      TRACE_SCOPE("Render");
      RenderScene();
    }

    {
      TRACE_SCOPE("Network");
      SyncState();
    }
  }
}

// On shutdown
TRACE_SAVE("game_trace.json");
// Open in chrome://tracing or https://ui.perfetto.dev/
```

### Viewing Traces

1. Run your application with trace recording enabled
2. Call `TRACE_SAVE("output.json")` at the point you want to capture
3. Open Chrome and navigate to `chrome://tracing`
4. Click "Load" and select your trace file
5. Or use [Perfetto UI](https://ui.perfetto.dev/) for a modern viewer

The trace shows:
- Duration of each scoped event as colored bars
- Nesting (parent-child relationships)
- Thread information
- Instant markers as vertical lines

::: tip
The tracer uses `forward_list` internally to minimize memory overhead. It's suitable for always-on recording in production if you limit the trace window.
:::

## Compile-Time Stripping

| Module | Disable Flag | Effect |
|--------|-------------|--------|
| Inspect | `INSPECT_DISABLE=ON` (CMake) | All `INSPECT_*` macros become no-ops; Inspect class not compiled |
| Tracer | Don't define `ENABLE_TRACE_RECORDING` | All `TRACE_*` macros become no-ops |

This means you can sprinkle debug instrumentation throughout your code and have zero runtime cost in production builds.

## Complete Example

```cpp
#define ENABLE_TRACE_RECORDING
#include <xtils/app/service.h>
#include <xtils/debug/inspect.h>
#include <xtils/debug/tracer.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class DebugService : public Service<DebugService> {
 public:
  DebugService() : Service("debug") {}

  void Init() override {
    auto port = config.GetInt("inspect_port").value_or(9090);
    Inspect::Get().Init("0.0.0.0", port);

    // System info endpoint
    INSPECT_ROUTE("/system/info", "System information", [](const auto&) {
      Json info;
      info["version"] = "1.0.0";
      info["uptime"] = GetUptime();
      info["pid"] = getpid();
      return Inspect::Json(info);
    });

    // Trace control
    INSPECT_ROUTE("/trace/save", "Save trace data", [](const auto&) {
      TRACE_SAVE("runtime_trace.json");
      return Inspect::Success("Trace saved");
    });

    LogI("[Debug] Inspect server on port %d", (int)port);
  }

  void Deinit() override {
    TRACE_SAVE("shutdown_trace.json");
    Inspect::Get().Stop();
  }
};
```
