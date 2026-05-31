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
inspect.Stop();
```

### Registering Routes

```cpp
// Route with description (shown in built-in Web Console)
inspect.Route("/debug/stats", "Application statistics",
    [](const Inspect::Request& req, Inspect::Response& resp) {
  Json stats;
  stats["uptime_s"] = GetUptime();
  stats["requests"] = request_count;
  resp = Inspect::Json(stats);
});

// Static content (e.g., embedded HTML dashboard)
inspect.Static("/debug/dashboard", dashboard_html, "text/html");
```

### Response Helpers

```cpp
static Inspect::Response Json(const xtils::Json& json);
static Inspect::Response Text(const std::string& text);
static Inspect::Response Html(const std::string& html);
static Inspect::Response Error(const std::string& message);
static Inspect::Response Success(const std::string& message = "OK");
```

### API Methods

```cpp
auto& inspect = Inspect::Get();

// Query routes
bool exists = inspect.HasRoute("/debug/fsm");
auto routes = inspect.GetRoutes();            // Returns registered HTTP route list
auto ws_routes = inspect.GetWebSocketRoutes(); // Returns registered WebSocket route list

// Unregister a route
inspect.Unregister("/debug/fsm");

// Server status
bool running = inspect.IsRunning();
auto info = inspect.GetServerInfo();  // Returns address, port, etc.

// Subscribers
size_t count = inspect.GetSubscriberCount("/debug/metrics");

// CORS configuration
inspect.SetCORS("*");  // Allow all origins
inspect.SetCORS("http://localhost:3000");  // Restrict to specific origin
```

### WebSocket Pub/Sub

Register WebSocket endpoints and publish data to all subscribers:

```cpp
// Register a WebSocket endpoint
inspect.WebSocket("/debug/metrics", "Live metrics stream",
    [](const Inspect::Request& req, Inspect::Response& resp) {
  resp = Inspect::Success();
});

// Publish to all connected WebSocket clients
Json metrics;
metrics["cpu"] = cpu_percent;
metrics["memory_mb"] = memory_mb;
inspect.Publish("/debug/metrics", metrics);

// Check if anyone is listening (avoid expensive serialization)
if (inspect.HasSubscribers("/debug/metrics")) {
  inspect.Publish("/debug/metrics", CollectMetrics().dump());
}

// Get detailed publish results
auto result = inspect.PublishWithResult("/debug/metrics", message);
if (result.HasFailures()) {
  LogW("Publish failed: %zu", result.failed_count);
}
```

### Web Console

Inspect ships with a built-in two-panel Web Console (accessible at the root path):

- **Left panel**: Registered routes list; click to send a request
- **Right panel top**: HTTP panel — supports GET/POST, auto-formats JSON responses
- **Right panel bottom**: WebSocket panel — live message stream, color-coded by direction/type

No extra configuration needed — just start the Inspect server and visit it in a browser.

> **Note**: The Web Console HTML source is maintained in `src/debug/inspect_page.html` and embedded into the binary via `cmake/embed_file.cmake`.

### Macros (Zero-Cost When Disabled)

These macros compile to nothing when `INSPECT_DISABLE` is defined:

```cpp
// HTTP route — req and resp are available in body
INSPECT("/debug/fsm", "FSM state", {
  resp = Inspect::Json(fsm.ToJson());
});

// WebSocket endpoint
INSPECT_WS("/debug/events", "Live events", {
  resp = Inspect::Success();
});

// Expose a variable as JSON {"value": expr}
INSPECT_VAR("/debug/counter", counter.load());

// Static content
INSPECT_STATIC("/debug/dashboard", dashboard_html, "text/html");

// Publish text data
INSPECT_PUBLISH("/debug/events", event_json.dump());

// Publish binary data
INSPECT_PUBLISH_BIN("/debug/binary", binary_data);
```

### Use Case: Live Dashboard

```cpp
class MonitorService : public Service<MonitorService> {
 public:
  MonitorService() : Service("monitor") {}

  void Init() override {
    INSPECT_WS("/debug/live", "Real-time metrics", {
      resp = Inspect::Success();
    });

    INSPECT_VAR("/debug/connections", GetConnectionCount());

    ctx->Every(1000, [this]() {
      if (!Inspect::Get().HasSubscribers("/debug/live")) return;

      Json m;
      m["timestamp"] = SteadyTimer::GetCurrentTimestampMs();
      m["connections"] = GetConnectionCount();
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
TRACE_SCOPE("ProcessFrame")    // Scoped event (RAII)
TRACE_INSTANT("FrameReady")   // Instant event
TRACE_SAVE("trace.json")      // Save to file
```

### Example: Profiling a Frame Loop

```cpp
#define ENABLE_TRACE_RECORDING
#include <xtils/debug/tracer.h>

void GameLoop() {
  while (running) {
    TRACE_SCOPE("Frame");

    {
      TRACE_SCOPE("Physics");
      UpdatePhysics();
    }

    {
      TRACE_SCOPE("Render");
      RenderScene();
    }
  }
}

TRACE_SAVE("game_trace.json");
// Open in chrome://tracing or https://ui.perfetto.dev/
```

### Viewing Traces

1. Run your application with trace recording enabled
2. Call `TRACE_SAVE("output.json")`
3. Open Chrome and navigate to `chrome://tracing`
4. Click "Load" and select your trace file
5. Or use [Perfetto UI](https://ui.perfetto.dev/) for a modern viewer

## Compile-Time Stripping

| Module | Disable Flag | Effect |
|--------|-------------|--------|
| Inspect | `INSPECT_DISABLE=ON` (CMake) | `INSPECT`, `INSPECT_WS`, `INSPECT_VAR`, `INSPECT_STATIC`, `INSPECT_PUBLISH`, `INSPECT_PUBLISH_BIN` macros become no-ops |
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
    auto port = config.GetOr<int>("inspect_port", 9090);
    Inspect::Get().Init("0.0.0.0", port);

    INSPECT("/system/info", "System information", {
      Json info;
      info["version"] = "1.0.0";
      info["uptime"] = GetUptime();
      info["pid"] = getpid();
      resp = Inspect::Json(info);
    });

    INSPECT("/trace/save", "Save trace data", {
      TRACE_SAVE("runtime_trace.json");
      resp = Inspect::Success("Trace saved");
    });

    LogI("[Debug] Inspect server on port %d", port);
  }

  void Deinit() override {
    TRACE_SAVE("shutdown_trace.json");
    Inspect::Get().Stop();
  }
};
```
