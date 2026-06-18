# App Framework

The App framework provides the application skeleton: lifecycle management, service registration, event dispatching, and timer scheduling.

## Overview

At its core, xtils applications follow a simple pattern:

1. Define services that implement `Init()` / `Deinit()`
2. Register them with the `App` singleton
3. The framework manages the event loop, thread pool, and shutdown

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

class NetworkService : public xtils::Service<NetworkService> {
 public:
  NetworkService() : Service("network") {}

  void Init() override {
    // Infrastructure is ready — event loop, thread pool, config all available
    auto port = config.GetInt("port").value_or(8080);
    LogI("Starting on port %d", (int)port);
    
    // Use timers
    ctx->Every(5000, [this]() { SendHeartbeat(); });
  }

  void Deinit() override {
    // Infrastructure still alive — safe to do network cleanup
    CloseConnections();
  }
};
```

## App Singleton

```cpp
#include "xtils/app/app.h"

App* App::Ins();  // Get the singleton instance
```

### Service Registration

```cpp
// Register a single service
app.Register(std::make_shared<MyService>());

// Register multiple services (initialized in order)
app.Register({
  std::make_shared<DatabaseService>(),
  std::make_shared<NetworkService>(),
  std::make_shared<UIService>()
});
```

### Lifecycle Control

```cpp
void Init(const std::vector<std::string>& args);  // Initialize with CLI args
void Run();                                        // Block until shutdown
void RunDaemon();                                  // Run event loop in background thread
bool IsRunning();                                  // Check if app is running
```

### Task Scheduling

```cpp
// Post a task to the main thread (event loop)
ctx->Spawn([]() {
  // Runs on main thread
});

// Post CPU-bound work to thread pool, with optional main-thread callback
ctx->SpawnAsync(
  []() { /* heavy work on worker thread */ },
  []() { /* callback on main thread after completion */ }
);
```

### Timers

```cpp
// Repeating timer (fires every 1000ms)
ctx->Every(1000, []() { LogD("tick"); });

// One-shot timer (fires once after 5000ms)
ctx->Delay(5000, []() { LogI("delayed!"); });
```

### Events (Pub/Sub)

```cpp
// Define an event struct
struct UserLoggedIn { std::string username; int user_id; };

// Subscribe (in any service)
ctx->Connect<UserLoggedIn>([](const UserLoggedIn& e) {
  LogI("User logged in: %s", e.username.c_str());
});

// Publish (from any service)
ctx->Emit(UserLoggedIn{"alice", 42});
```

Events can also be enum-based for simpler signaling:

```cpp
enum class AppEvent { DataReady, Shutdown, Refresh };

ctx->Connect<AppEvent>(AppEvent::DataReady, [](const AppEvent& e) {
  // Handle data ready
});

ctx->Emit(AppEvent::DataReady);
```

## Service Interface

### `IService` — Base class

```cpp
class IService {
 public:
  explicit IService(const char* name);
  virtual void Init() = 0;    // Called after infrastructure is ready
  virtual void Deinit() = 0;  // Called before infrastructure shutdown

  // Names of services this one depends on. App initialises dependencies
  // first (topological order) and deinitialises them in reverse. Default:
  // no dependencies.
  virtual std::vector<std::string> Dependencies() const { return {}; }

  const std::string& Name() const;

 protected:
  App* ctx;       // App context (injected by framework)
  Config config;  // Service-specific config section
  std::string name;
};
```

### Service dependencies and topological order

Override `Dependencies()` to declare which services must finish `Init()` before this one:

```cpp
class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  std::vector<std::string> Dependencies() const override {
    return {"database", "cache"};
  }

  void Init() override {
    // database and cache have already returned from Init()
  }
};
```

- App calls `Init()` in topological order and `Deinit()` in reverse topological order.
- Cycles or unknown dependency names abort the process loudly so misconfiguration is caught early.
- `App::TopoSortServices()` is exposed so the dependency graph is unit-testable.

### `Service<T>` — CRTP helper

```cpp
template <typename T>
class Service : public IService {
 public:
  explicit Service(const char* name);

  auto GetWeakPtr();           // Get a weak pointer to this service
  
  template <typename E>
  void Emit(const E& event);  // Convenience: emit through ctx
};
```

### Service Lifecycle Guarantees

| Phase | What's Available | Typical Use |
|-------|-----------------|-------------|
| Constructor | Nothing (no `ctx`) | Store constructor args only |
| `Init()` | Event loop, thread pool, config, other services | Start connections, register routes, start timers |
| Running | Everything | Normal operation |
| `Deinit()` | Event loop, thread pool (still running!) | Close connections, flush buffers, cancel timers |
| Destructor | Nothing | Release memory |

::: warning
Do not perform I/O or use timers in the constructor or destructor. Use `Init()` and `Deinit()` instead.
:::

## Global Functions

For simple applications that don't need the full service pattern:

```cpp
#include "xtils/app/service.h"

xtils::Init(argc, argv);       // Initialize with args
xtils::Init({"--config-file", "app.json"});

if (xtils::IsOk()) {
  // App initialized successfully
}

xtils::RunForever();  // Block on event loop
xtils::RunDaemon();   // Run in background
xtils::Shutdown();    // Trigger graceful shutdown
```

## Configuration Integration

Each service automatically receives a config section matching its name:

```json
{
  "network": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "database": {
    "url": "localhost:5432"
  }
}
```

```cpp
class NetworkService : public Service<NetworkService> {
  NetworkService() : Service("network") {}  // ← name matches JSON key

  void Init() override {
    // config is pre-populated with the "network" section
    auto port = config.GetInt("port").value_or(8080);
    auto host = config.GetString("host").value_or("0.0.0.0");
  }
};
```

## Complete Example

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

using namespace xtils;

class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  void Init() override {
    auto port = config.GetOr<int>("port", 8080);

    runner_ = ThreadTaskRunner::CreateAndStart("api_io");
    router_ = std::make_unique<HttpRouter>();

    router_->Get("/api/health",
        [](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
      res.Status(200).Json("{\"status\":\"ok\"}");
    });

    router_->Post("/api/data",
        [this](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
      auto body = ctx.GetBody();
      LogI("Received: %s", body.c_str());
      res.Status(201).Json("{\"created\":true}");
    });

    handler_ = std::make_unique<RouterHttpRequestHandler>(std::move(router_));
    server_ = std::make_unique<HttpServer>(runner_.get(), handler_.get());
    server_->Start("0.0.0.0", port);

    LogI("[API] Server started on port %d", port);
  }

  void Deinit() override {
    server_->Stop();
    LogI("[API] Server stopped");
  }

 private:
  ThreadTaskRunner runner_;
  std::unique_ptr<HttpRouter> router_;
  std::unique_ptr<RouterHttpRequestHandler> handler_;
  std::unique_ptr<HttpServer> server_;
};

void app_main(App& app, const std::vector<std::string>& args) {
  app.Register(std::make_shared<ApiService>());
}
```
