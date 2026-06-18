# 网络

Networking 模块提供完整的网络原语：TCP/UDP 客户端和服务器、带 Express 风格路由的 HTTP 客户端和服务器、HTTP 客户端连接池、支持自动重连的 WebSocket 客户端、multipart form-data 解析、JSON-RPC IPC 通道，以及 TLS 支持。

## 概述

xtils 中的所有网络操作都是事件驱动和非阻塞的，构建在 `TaskRunner` 事件循环之上。回调在事件循环线程上触发，使编程模型简单可预测 — 默认无数据竞争。

```cpp
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

auto runner = ThreadTaskRunner::CreateAndStart("server");
HttpRouter router;

router.Get("/api/hello",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  res.Status(200).Json("{\"message\":\"Hello!\"}");
});

HttpServer server(runner.get(), &router);
server.Start("0.0.0.0", 8080);
```

::: tip 类型别名
- 路由处理器中的请求/响应类型推荐使用 `HttpRouter::Context` / `HttpRouter::Response`（等价于 `HttpRequestContext` / `HttpRouterResponse`，新代码统一用前者）
- 服务端连接、原始请求暴露为 `HttpServer::Connection` / `HttpServer::Request`
- 客户端类型嵌在 `HttpClient` 内部：`HttpClient::Request` / `HttpClient::Response` / `HttpClient::Listener` / `HttpClient::MultipartField` / `HttpClient::MultipartFile`
:::

## TCP 客户端

```cpp
#include "xtils/net/tcp_client.h"

class TcpClientEventListener {
  virtual void OnConnected(bool success) = 0;
  virtual void OnDataReceived(const void* data, size_t len) = 0;
  virtual void OnDisconnected() = 0;
};

TcpClient(TaskRunner* runner, TcpClientEventListener* listener);
bool Connect(const std::string& address, uint16_t port);
bool ConnectToHost(const std::string& hostname, uint16_t port);  // DNS 解析
void Disconnect();
bool Send(const void* data, size_t len);
bool SendString(const std::string& data);
bool IsConnected() const;
```

## TCP 服务器

```cpp
#include "xtils/net/tcp_server.h"

class TcpServerEventListener {
  virtual void OnClientConnected(TcpServerConnection* conn) = 0;
  virtual void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) = 0;
  virtual void OnClientDisconnected(TcpServerConnection* conn) = 0;
};

TcpServer(TaskRunner* runner, TcpServerEventListener* listener);
bool Start(const std::string& address, uint16_t port);
bool StartDualStack(uint16_t port);  // IPv4 + IPv6
void Stop();
void Broadcast(const void* data, size_t len);
```

### 示例：回显服务器

```cpp
class EchoServer : public TcpServerEventListener {
  void OnClientConnected(TcpServerConnection* conn) override {
    LogI("客户端已连接: %s", conn->GetRemoteAddress().c_str());
  }
  void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) override {
    conn->Send(data, len);  // 回显
  }
  void OnClientDisconnected(TcpServerConnection* conn) override {
    LogI("客户端已断开");
  }
};

EchoServer handler;
TcpServer server(&runner, &handler);
server.Start("0.0.0.0", 9000);
```

## UDP 客户端/服务器

```cpp
#include "xtils/net/udp_client.h"
#include "xtils/net/udp_server.h"

// 客户端
UdpClient client(&runner, &listener);
client.Open();
client.SendTo("192.168.1.100:9000", data, len);
client.SetBroadcast(true);
client.JoinMulticastGroup("239.0.0.1");

// 服务器
UdpServer server(&runner, &listener);
server.Start("0.0.0.0", 9000);
server.SendTo(client_addr, data, len);
server.SetClientTimeout(30000);
```

## HTTP 客户端

```cpp
#include "xtils/net/http_client.h"

HttpClient client(&runner);

// 同步入口（统一为 Send；single-flight：同一时间只允许一个请求在飞）
HttpClient::Request req;
req.method = HttpMethod::kPost;
req.url = HttpUrl::Parse("https://api.example.com/items").value();
req.SetJsonBody(R"({"name":"foo"})");
HttpClient::Response res = client.Send(req);

// 便捷方法
HttpClient::Response r1 = client.Get("https://api.example.com/data");
HttpClient::Response r2 = client.PostJson(url, json_string);
HttpClient::Response r3 = client.PostForm(url, {{"key", "value"}});
HttpClient::Response r4 = client.PostMultipart(url, fields, files);

// 异步：实现 HttpClient::Listener 即可
class MyListener : public HttpClient::Listener {
  void OnHttpResponse(HttpClient*, const HttpClient::Response& res) override {
    LogI("状态: %d", res.status_code);
  }
  void OnHttpError(HttpClient*, const std::string& err) override {
    LogE("错误: %s", err.c_str());
  }
};
client.GetAsync(url, &listener);

// 配置
client.SetTimeout(10000);
client.SetFollowRedirects(true, 5);
client.SetKeepAlive(true);
client.SetVerifySSL(true);
client.Cancel();  // 取消正在进行的请求
```

::: warning 单飞语义
单个 `HttpClient` 实例同时只允许一个请求在飞（这是 v2.0 显式且原子化的语义）。需要并发时使用下面的 `HttpClientPool`。
:::

## HttpClientPool — HTTP 客户端连接池

```cpp
#include "xtils/net/http_client_pool.h"

// size <= 0 时退化为 std::thread::hardware_concurrency()
HttpClientPool pool(&task_runner, /*size=*/4);

// 同步：自动 acquire + send + release
auto resp = pool.Send(request);
auto resp2 = pool.Send(request, std::chrono::milliseconds(5000));  // acquire 超时

// 手动 acquire（RAII 句柄，析构时自动 release）
{
  auto handle = pool.Acquire(std::chrono::milliseconds(2000));
  if (!handle) { LogE("acquire timeout"); }
  else {
    handle->SendAsync(request, &listener);
    // ...
  }
}
```

`HttpClientPool::Send()` 在没有空闲实例时会构造一个 `status_code == 0` 的错误响应（`status_message` 描述失败原因）。

## HTTP 路由（Express 风格）

```cpp
#include "xtils/net/http_router.h"

HttpRouter router;

// 路由注册
router.Get   ("/api/users",     handler);
router.Post  ("/api/users",     handler);
router.Put   ("/api/users/:id", handler);
router.Delete("/api/users/:id", handler);

// 处理器签名（推荐用别名）
void handler(const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  auto id   = ctx.GetParam("id");          // URL 参数
  auto q    = ctx.GetQuery("search");      // 查询参数
  auto body = ctx.GetBody();               // 请求体
  auto auth = ctx.GetHeader("Authorization");

  res.Status(200).Json("{\"ok\":true}");
}
```

::: tip 路径参数
路由模式同时支持 Express 风格的 `:param` 与原有的 `{param}` 语法：

```cpp
router.Get("/users/:id/posts/:post_id", handler);  // Express 风格
router.Get("/users/{id}/posts/{post_id}", handler); // 原语法（仍可用）
```
:::

### 中间件

```cpp
// 全局中间件
router.Use([](const HttpRouter::Context& ctx, HttpRouter::Response& res) -> bool {
  LogI("%s %s", ctx.GetMethod().c_str(), ctx.GetPath().c_str());
  return true;  // 继续（false = 中止）
});

// 路径限定中间件
router.Use("/api",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) -> bool {
  if (ctx.GetHeader("Authorization").empty()) {
    res.Status(401).Json("{\"error\":\"unauthorized\"}");
    return false;
  }
  return true;
});
```

### 静态文件与路由组

```cpp
router.Static("/static", "./public");
router.EnableCors("*", "GET,POST,PUT,DELETE,OPTIONS");

auto api = router.Group("/api/v1");
api.Get ("/users", listUsers);
api.Post("/users", createUser);
```

## WebSocket 客户端

```cpp
#include "xtils/net/websocket_client.h"

class WsHandler : public WebSocketClientEventListener {
  void OnWebSocketConnected(WebSocketClient* client) override {
    client->SendText("{\"type\":\"subscribe\"}");
  }
  void OnWebSocketMessage(WebSocketClient* client, const WebSocketMessage& msg) override {
    LogI("消息: %s", msg.text.c_str());
  }
  void OnWebSocketClosed(WebSocketClient*, uint16_t code, const std::string& reason) override {
    LogW("WS 关闭: %d", code);
  }
  void OnWebSocketError(WebSocketClient*, const std::string& error) override {
    LogE("WS 错误: %s", error.c_str());
  }
};

WsHandler handler;
WebSocketClient ws(&runner, &handler);
ws.SetAutoReconnect(true, 5000);   // 自动重连，5 秒延迟
ws.SetPingInterval(30000);         // 每 30 秒发送 ping
ws.Connect("wss://api.example.com/ws");
```

::: tip
v2.0 起 WebSocket 客户端独立处理 HTTP 升级握手，不再依赖 `HttpClient` / `HttpClientEventListener`。
:::

## HTTP Server 配置

```cpp
#include "xtils/net/http_server.h"

struct HttpServerConfig {
  // 最大 HTTP 请求体大小。超过则返回 413 Payload Too Large。
  size_t max_payload_size = 4 * 1024 * 1024;  // 默认 4 MB
};

// 使用默认配置
HttpServer server(&runner, &handler);

// 自定义最大请求体大小（嵌入式：限制为 1MB）
HttpServerConfig config;
config.max_payload_size = 1 * 1024 * 1024;
HttpServer server2(&runner, &handler, config);

// 文件上传服务（允许 64MB）
HttpServerConfig big;
big.max_payload_size = 64 * 1024 * 1024;
HttpServer server3(&runner, &handler, big);
```

::: tip
在内存受限的环境中（如 RAM < 30MB 的嵌入式设备），建议显式调小 `max_payload_size`。
:::

### 文件流式响应

`HttpServer::Connection`（即 `HttpServerConnection`）提供 64KB 分块发送大文件的能力，避免整文件读入内存：

```cpp
router.Get("/files/:name",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  // \u67d0\u4e9b\u573a\u666f\u4e0b\u53ef\u4ee5\u4ece\u8fde\u63a5\u8c03\u7528 SendFileStreaming\uff0c
  // \u5177\u4f53\u53c2\u8003 examples/http_server_example.cc\u3002
});
```

## Multipart 解析

处理文件上传和表单数据：

```cpp
#include "xtils/net/http_multipart.h"

router.Post("/upload",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  auto& files  = ctx.GetMultipartFiles();   // 首次访问时解析
  auto& fields = ctx.GetMultipartFields();

  for (auto& file : files) {
    LogI("文件: %s (%zu 字节)", file.filename.c_str(), file.content.size());
  }
  res.Status(200).Json("{\"uploaded\":" + std::to_string(files.size()) + "}");
});
```

## TLS 工厂

```cpp
#include "xtils/net/transport/tls_factory.h"

TlsContextPtr CreateTlsContext(const TlsCertConfig& cfg);
std::unique_ptr<Transport> CreateTlsTransport(TaskRunner* runner,
                                              TransportEventListener* listener);
```

后端（OpenSSL 或 mbedTLS）在编译时通过 `TLS_BACKEND` 选择。

## IPC 通道

`xtils/net/ipc_channel.h` 提供 JSON-RPC 2.0 over Unix 域 / abstract Unix / TCP 的进程间通信。详见独立章节：

- [IPC 通道（JSON-RPC）](/modules/ipc)

## 综合示例

一个完整的服务器，包含 REST API、WebSocket 和静态文件：

```cpp
#include <xtils/app/service.h>
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

using namespace xtils;

class WebService : public Service<WebService> {
 public:
  WebService() : Service("web") {}

  void Init() override {
    runner_ = ThreadTaskRunner::CreateAndStart("web_io");
    router_ = std::make_unique<HttpRouter>();

    router_->Get("/api/status",
        [this](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
      Json status = Json::object();
      status["uptime"]  = GetUptime();
      status["clients"] = ws_clients_;
      res.Status(200).Json(status.dump());
    });

    router_->Static("/", config.GetOr<std::string>("web_root", "./public"));
    router_->EnableCors("*", "GET,POST,OPTIONS");

    handler_ = std::make_unique<RouterHttpRequestHandler>(std::move(router_));
    server_ = std::make_unique<HttpServer>(runner_.get(), handler_.get());
    server_->Start("0.0.0.0", config.GetOr<int>("port", 8080));
  }

  void Deinit() override { server_->Stop(); }

 private:
  ThreadTaskRunner runner_;
  std::unique_ptr<HttpRouter> router_;
  std::unique_ptr<RouterHttpRequestHandler> handler_;
  std::unique_ptr<HttpServer> server_;
  int ws_clients_ = 0;
};
```

::: tip 线程安全
所有网络回调在 TaskRunner 的线程上触发。如果使用 `ThreadTaskRunner`，该服务器的所有回调都在其专用线程上串行化 — 处理器内无需加锁。
:::
