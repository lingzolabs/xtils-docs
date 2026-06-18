# IPC 通道（JSON-RPC）

`IpcServer` / `IpcClient` 提供基于换行分隔 JSON-RPC 2.0 的进程间通信，传输层复用 `UnixSocketRaw`，可在 filesystem Unix 域套接字、abstract Unix 套接字、TCP IPv4/IPv6 之间无缝切换。

## 概述

```
┌──────────────────────┐        JSON-RPC 2.0          ┌──────────────────────┐
│    IpcClient         │◄──────────────────────────►│    IpcServer         │
│  Call / CallAsync    │     newline-delimited        │  Register / OnNotify │
│  Notify / OnNotify   │                              │  Notify              │
└──────────────────────┘                              └──────────────────────┘
```

地址格式（与 `UnixSocketRaw::GetSockFamily` 相同的判定规则）：

| 形式 | 含义 |
|------|------|
| `/path/to/socket` | filesystem Unix 域套接字 |
| `@abstract_name` | abstract Unix 套接字（Linux） |
| `127.0.0.1:9000` | TCP IPv4 |
| `[::1]:9000` | TCP IPv6 |

线协议（一行一条 JSON-RPC 2.0 消息）：

```jsonc
// 请求
{"jsonrpc":"2.0","id":1,"method":"getStatus","params":{"key":"val"}}

// 响应（成功）
{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}

// 响应（错误）
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}

// 通知（无 id，无响应）
{"jsonrpc":"2.0","method":"notify","params":{"event":"data"}}
```

## 头文件

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

  // 注册同步方法（产生 result 或 error）
  void Register(const std::string& method, MethodHandler handler);

  // 注册通知 handler（不发响应）
  void OnNotify(const std::string& method, NotifyHandler handler);

  // 向所有已连接客户端广播通知
  void Notify(const std::string& method, const Json& params = Json::object());

  bool Start();
  void Stop();
  size_t ClientCount() const;
};
```

::: tip 执行模型
若构造时未传 `TaskGroup`，handler 会在共享的并行默认 `TaskGroup` 上派发；不在每个 client 的读线程上同步执行，避免一个慢 handler 阻塞整个连接。
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

  // 同步调用
  Result<Json> Call(const std::string& method,
                    const Json& params = Json::object(),
                    uint32_t timeout_ms = 5000);

  // 异步调用（callback 在 callback TaskGroup 上派发）
  void CallAsync(const std::string& method, const Json& params,
                 std::function<void(Result<Json>)> callback);

  // 通知（无响应）
  bool Notify(const std::string& method, const Json& params = Json::object());

  // 订阅服务端推送的通知
  Subscription OnNotify(const std::string& method, NotifyCallback cb);
  Subscription OnNotify(NotifyCallback cb);  // 所有 method
};
```

## JSON-RPC 错误码

```cpp
namespace xtils::jsonrpc {
  constexpr int kParseError     = -32700;
  constexpr int kInvalidRequest = -32600;
  constexpr int kMethodNotFound = -32601;
  constexpr int kInvalidParams  = -32602;
  constexpr int kInternalError  = -32603;
  // 服务器自定义错误：-32000 ~ -32099
}
```

## 完整示例

### 服务端

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
      server_->Notify("heartbeat", hb);  // 广播给所有客户端
    });
  }

  void Deinit() override { server_->Stop(); }

 private:
  std::unique_ptr<IpcServer> server_;
  int64_t uptime_ms_ = 0;
};
```

### 客户端

```cpp
#include <xtils/net/ipc_channel.h>

using namespace xtils;

int main() {
  IpcClient client("/tmp/myapp.sock");
  if (!client.Connect()) {
    LogE("connect failed");
    return 1;
  }

  // 订阅心跳
  auto sub = client.OnNotify("heartbeat",
      [](const std::string&, const Json& p) {
        LogI("heartbeat t=%lld", p.get_integer("t").value_or(0));
      });

  // 同步调用
  auto r = client.Call("ping", Json::parse(R"({"hello":"world"})").value(),
                       2000);
  if (r) LogI("pong: %s", r->dump().c_str());
  else   LogE("ping err: %s", r.error().message.c_str());

  // 异步调用
  client.CallAsync("getStatus", Json::object(),
      [](Result<Json> res) {
        if (res) LogI("status: %s", res->dump().c_str());
      });

  // 通知（不要响应）
  Json log_msg = Json::object();
  log_msg["level"] = "info";
  log_msg["msg"]   = "client started";
  client.Notify("log", log_msg);

  std::this_thread::sleep_for(std::chrono::seconds(5));
  client.Disconnect();
}
```

## 自定义执行器

把同一个 `TaskGroup` 注入服务端与客户端可以让回调在指定线程池执行：

```cpp
auto tg = TaskGroup::Parallel(2);

IpcServer server("@my.bus", *tg);    // method/notify handler 在 tg 上派发
IpcClient client("@my.bus", *tg);    // CallAsync / OnNotify 回调在 tg 上派发
```

::: tip 提示
- `Notify` 是单向的；不要等待响应
- `CallAsync` 不再为每个调用 detach 单独的等待线程，回调在指定 `TaskGroup` 上 dispatch
- 服务端在 v2.0 之前会阻塞读循环执行 handler；现在通过 `TaskGroup` 派发，慢 handler 不会阻塞同一连接的下一条消息
- 对端在客户端 `Disconnect()` 之前断开时，等待中的 `Call` 会被唤醒、读线程会被正确回收
:::
