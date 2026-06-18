# IPC Channel (JSON-RPC)

`IpcServer` / `IpcClient` provide newline-delimited JSON-RPC 2.0 messaging over `UnixSocketRaw`. The same code works for filesystem Unix sockets, abstract Unix sockets, and TCP IPv4/IPv6.

## Overview

```
┌──────────────────────┐        JSON-RPC 2.0          ┌──────────────────────┐
│    IpcClient         │◄──────────────────────────►│    IpcServer         │
│  Call / CallAsync    │     newline-delimited        │  Register / OnNotify │
│  Notify / OnNotify   │                              │  Notify              │
└──────────────────────┘                              └──────────────────────┘
```

Address format (same rules as `UnixSocketRaw::GetSockFamily`):

| Form | Meaning |
|------|---------|
| `/path/to/socket` | filesystem Unix socket |
| `@abstract_name` | abstract Unix socket (Linux) |
| `127.0.0.1:9000` | TCP IPv4 |
| `[::1]:9000` | TCP IPv6 |

Wire format (one JSON-RPC 2.0 message per line):

```jsonc
// Request
{"jsonrpc":"2.0","id":1,"method":"getStatus","params":{"key":"val"}}

// Response (success)
{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}

// Response (error)
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}

// Notification (no id, no response)
{"jsonrpc":"2.0","method":"notify","params":{"event":"data"}}
```

## Header

```cpp
#include "xtils/net/ipc_channel.h"
```

## IpcServer

```cpp
class IpcServer {
 public:
  using MethodHandler = std::function<Result<Json>(const Json& params)>;
  using NotifyHandler = std::function<void(const Json& params)>;

  explicit IpcServer(const std::string& address);
  explicit IpcServer(const std::string& address, TaskGroup& handler_group);

  // Register a method handler that returns a result (or error).
  void Register(const std::string& method, MethodHandler handler);

  // Register a notification handler (no response sent).
  void OnNotify(const std::string& method, NotifyHandler handler);

  // Broadcast a notification to all connected clients.
  void Notify(const std::string& method, const Json& params = Json::object());

  bool Start();
  void Stop();
  size_t ClientCount() const;
};
```

::: tip Execution model
Without a custom `TaskGroup`, handlers dispatch on a shared parallel default `TaskGroup`. They no longer run inline on the per-client read thread, so a slow handler does not block other messages on the same connection.
:::

## IpcClient

```cpp
class IpcClient {
 public:
  using NotifyCallback =
      std::function<void(const std::string& method, const Json& params)>;

  explicit IpcClient(const std::string& address);
  explicit IpcClient(const std::string& address, TaskGroup& callback_group);

  bool Connect();
  void Disconnect();
  bool IsConnected() const;

  // Synchronous call.
  Result<Json> Call(const std::string& method,
                    const Json& params = Json::object(),
                    uint32_t timeout_ms = 5000);

  // Async call (callback runs on the callback TaskGroup).
  void CallAsync(const std::string& method, const Json& params,
                 std::function<void(Result<Json>)> callback);

  // Fire-and-forget notification.
  bool Notify(const std::string& method, const Json& params = Json::object());

  // Subscribe to server-pushed notifications.
  Subscription OnNotify(const std::string& method, NotifyCallback cb);
  Subscription OnNotify(NotifyCallback cb);  // any method
};
```

## JSON-RPC error codes

```cpp
namespace xtils::jsonrpc {
  constexpr int kParseError     = -32700;
  constexpr int kInvalidRequest = -32600;
  constexpr int kMethodNotFound = -32601;
  constexpr int kInvalidParams  = -32602;
  constexpr int kInternalError  = -32603;
  // Server-defined errors: -32000 to -32099
}
```

## Full example

### Server

```cpp
#include <xtils/app/service.h>
#include <xtils/net/ipc_channel.h>

using namespace xtils;

class ControlService : public Service<ControlService> {
 public:
  ControlService() : Service("ctrl") {}

  void Init() override {
    server_ = std::make_unique<IpcServer>("/tmp/myapp.sock");

    server_->Register("ping", [](const Json& params) -> Result<Json> {
      Json resp = Json::object();
      resp["pong"] = true;
      resp["echo"] = params;
      return Ok(std::move(resp));
    });

    server_->Register("getStatus", [this](const Json&) -> Result<Json> {
      Json s = Json::object();
      s["uptime_ms"] = uptime_ms_;
      s["clients"]   = static_cast<int64_t>(server_->ClientCount());
      return Ok(std::move(s));
    });

    server_->OnNotify("log", [](const Json& params) {
      LogI("client log: %s", params.dump().c_str());
    });

    server_->Start();

    ctx->Every(1000, [this]() {
      uptime_ms_ += 1000;
      Json hb = Json::object();
      hb["t"] = uptime_ms_;
      server_->Notify("heartbeat", hb);
    });
  }

  void Deinit() override { server_->Stop(); }

 private:
  std::unique_ptr<IpcServer> server_;
  int64_t uptime_ms_ = 0;
};
```

### Client

```cpp
#include <xtils/net/ipc_channel.h>

using namespace xtils;

int main() {
  IpcClient client("/tmp/myapp.sock");
  if (!client.Connect()) {
    LogE("connect failed");
    return 1;
  }

  auto sub = client.OnNotify("heartbeat",
      [](const std::string&, const Json& p) {
        LogI("heartbeat t=%lld", p.get_integer("t").value_or(0));
      });

  auto r = client.Call("ping", Json::parse(R"({"hello":"world"})").value(), 2000);
  if (r) LogI("pong: %s", r->dump().c_str());
  else   LogE("ping err: %s", r.error().message.c_str());

  client.CallAsync("getStatus", Json::object(),
      [](Result<Json> res) {
        if (res) LogI("status: %s", res->dump().c_str());
      });

  Json log_msg = Json::object();
  log_msg["level"] = "info";
  log_msg["msg"]   = "client started";
  client.Notify("log", log_msg);

  std::this_thread::sleep_for(std::chrono::seconds(5));
  client.Disconnect();
}
```

## Custom executor

Inject the same `TaskGroup` into both ends to run callbacks on a specific pool:

```cpp
auto tg = TaskGroup::Parallel(2);

IpcServer server("@my.bus", *tg);    // method/notify handlers dispatch on tg
IpcClient client("@my.bus", *tg);    // CallAsync / OnNotify callbacks dispatch on tg
```

::: tip Notes
- `Notify` is one-way; do not wait for a response.
- `CallAsync` no longer detaches one waiter thread per call. Callbacks are dispatched on the configured `TaskGroup`.
- Before v2.0 the server ran handlers inline on the read loop; now they go through the `TaskGroup`, so a slow handler doesn't block subsequent messages on the same connection.
- When the peer disconnects before `Disconnect()`, pending `Call`s are woken and the read thread is reaped correctly.
:::
