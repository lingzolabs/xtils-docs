# Networking

The Networking module provides a complete set of networking primitives: TCP/UDP clients and servers, an HTTP client and server with Express-style routing, an HTTP client connection pool, a WebSocket client with auto-reconnect, multipart form-data parsing, JSON-RPC IPC channels, and TLS support via pluggable backends.

## Overview

All networking in xtils is event-driven and non-blocking, built on the `TaskRunner` event loop. Callbacks fire on the event loop thread, making the programming model simple and predictable — no data races by default.

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

::: tip Type aliases (v2.0)
- Inside route handlers prefer `HttpRouter::Context` / `HttpRouter::Response` (these are aliases for `HttpRequestContext` / `HttpRouterResponse`).
- The server connection / raw request are exposed as `HttpServer::Connection` / `HttpServer::Request`.
- HTTP client types are nested: `HttpClient::Request`, `HttpClient::Response`, `HttpClient::Listener`, `HttpClient::MultipartField`, `HttpClient::MultipartFile`.
:::

## TCP Client

```cpp
#include "xtils/net/tcp_client.h"

class TcpClientEventListener {
 public:
  virtual void OnConnected(bool success) = 0;
  virtual void OnDataReceived(const void* data, size_t len) = 0;
  virtual void OnDisconnected() = 0;
};

TcpClient(TaskRunner* runner, TcpClientEventListener* listener);
bool Connect(const std::string& address, uint16_t port);
bool ConnectToHost(const std::string& hostname, uint16_t port);  // DNS resolved
void Disconnect();
bool Send(const void* data, size_t len);
bool SendString(const std::string& data);
bool IsConnected() const;
void SetKeepAlive(bool enable);
void SetNoDelay(bool enable);
```

## TCP Server

```cpp
#include "xtils/net/tcp_server.h"

class TcpServerEventListener {
 public:
  virtual void OnClientConnected(TcpServerConnection* conn) = 0;
  virtual void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) = 0;
  virtual void OnClientDisconnected(TcpServerConnection* conn) = 0;
};

TcpServer(TaskRunner* runner, TcpServerEventListener* listener);
bool Start(const std::string& address, uint16_t port);
bool StartDualStack(uint16_t port);  // IPv4 + IPv6
void Stop();
void Broadcast(const void* data, size_t len);
size_t GetConnectionCount() const;
```

### Example: echo server

```cpp
class EchoServer : public TcpServerEventListener {
  void OnClientConnected(TcpServerConnection* conn) override {
    LogI("Client connected: %s", conn->GetRemoteAddress().c_str());
  }
  void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) override {
    conn->Send(data, len);
  }
  void OnClientDisconnected(TcpServerConnection* conn) override {
    LogI("Client disconnected");
  }
};

EchoServer handler;
TcpServer server(&runner, &handler);
server.Start("0.0.0.0", 9000);
```

## UDP Client / Server

```cpp
#include "xtils/net/udp_client.h"
#include "xtils/net/udp_server.h"

// Client
UdpClient client(&runner, &listener);
client.Open();
client.SendTo("192.168.1.100:9000", data, len);
client.SetBroadcast(true);
client.JoinMulticastGroup("239.0.0.1");

// Server
UdpServer server(&runner, &listener);
server.Start("0.0.0.0", 9000);
server.SendTo(client_addr, data, len);
server.SetClientTimeout(30000);
```

## HTTP Client

```cpp
#include "xtils/net/http_client.h"

HttpClient client(&runner);

// Synchronous (unified entry: Send; single-flight per instance).
HttpClient::Request req;
req.method = HttpMethod::kPost;
req.url    = HttpUrl::Parse("https://api.example.com/items").value();
req.SetJsonBody(R"({"name":"foo"})");
HttpClient::Response res = client.Send(req);

// Convenience helpers
HttpClient::Response r1 = client.Get("https://api.example.com/data");
HttpClient::Response r2 = client.PostJson(url, json_string);
HttpClient::Response r3 = client.PostForm(url, {{"key", "value"}});
HttpClient::Response r4 = client.PostMultipart(url, fields, files);

// Async: implement HttpClient::Listener
class MyListener : public HttpClient::Listener {
  void OnHttpResponse(HttpClient*, const HttpClient::Response& res) override {
    LogI("status: %d", res.status_code);
  }
  void OnHttpError(HttpClient*, const std::string& err) override {
    LogE("error: %s", err.c_str());
  }
};
client.GetAsync(url, &listener);

// Configuration
client.SetTimeout(10000);
client.SetFollowRedirects(true, 5);
client.SetKeepAlive(true);
client.SetVerifySSL(true);
client.Cancel();  // cancel an in-flight request
```

::: warning Single-flight semantics
A single `HttpClient` instance allows only one in-flight request at a time (this is the explicit, atomic v2.0 contract). For concurrency use the `HttpClientPool` below.
:::

## HttpClientPool — concurrent HTTP requests

```cpp
#include "xtils/net/http_client_pool.h"

// size <= 0 falls back to std::thread::hardware_concurrency()
HttpClientPool pool(&task_runner, /*size=*/4);

// Synchronous: auto acquire + send + release
auto resp  = pool.Send(request);
auto resp2 = pool.Send(request, std::chrono::milliseconds(5000));  // acquire timeout

// Manual borrow (RAII handle releases on destruction)
{
  auto handle = pool.Acquire(std::chrono::milliseconds(2000));
  if (!handle) { LogE("acquire timeout"); }
  else {
    handle->SendAsync(request, &listener);
  }
}
```

`HttpClientPool::Send()` returns a synthetic error response (`status_code == 0`, `status_message` describing the failure) if no client could be acquired in time.

## HTTP Router (Express style)

```cpp
#include "xtils/net/http_router.h"

HttpRouter router;

router.Get   ("/api/users",     handler);
router.Post  ("/api/users",     handler);
router.Put   ("/api/users/:id", handler);
router.Delete("/api/users/:id", handler);
router.Any   ("/api/*",         handler);

// Handler signature
void handler(const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  auto id     = ctx.GetParam("id");          // URL parameter
  auto search = ctx.GetQuery("q");           // query string
  auto body   = ctx.GetBody();               // request body
  auto auth   = ctx.GetHeader("Authorization");

  // Multipart form (lazily parsed)
  auto& fields = ctx.GetMultipartFields();
  auto& files  = ctx.GetMultipartFiles();

  res.Status(200).Json("{\"ok\":true}");
}
```

::: tip Path parameter syntax
Both Express style `:param` and the original `{param}` are supported:

```cpp
router.Get("/users/:id/posts/:post_id",   handler);  // Express
router.Get("/users/{id}/posts/{post_id}", handler);  // legacy
```
:::

### Middleware

```cpp
router.Use([](const HttpRouter::Context& ctx, HttpRouter::Response& res) -> bool {
  LogI("%s %s", ctx.GetMethod().c_str(), ctx.GetPath().c_str());
  return true;  // false aborts the chain
});

router.Use("/api",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) -> bool {
  if (ctx.GetHeader("Authorization").empty()) {
    res.Status(401).Json("{\"error\":\"unauthorized\"}");
    return false;
  }
  return true;
});
```

### Static files and route groups

```cpp
router.Static("/static", "./public");
router.EnableCors("*", "GET,POST,PUT,DELETE,OPTIONS");

auto api = router.Group("/api/v1");
api.Get ("/users", listUsers);
api.Post("/users", createUser);
```

## WebSocket Client

```cpp
#include "xtils/net/websocket_client.h"

class WsHandler : public WebSocketClientEventListener {
  void OnWebSocketConnected(WebSocketClient* client) override {
    client->SendText("{\"type\":\"subscribe\"}");
  }
  void OnWebSocketMessage(WebSocketClient* client, const WebSocketMessage& msg) override {
    LogI("msg: %s", msg.text.c_str());
  }
  void OnWebSocketClosed(WebSocketClient*, uint16_t code, const std::string& reason) override {
    LogW("ws closed: %d", code);
  }
  void OnWebSocketError(WebSocketClient*, const std::string& err) override {
    LogE("ws error: %s", err.c_str());
  }
};

WsHandler handler;
WebSocketClient ws(&runner, &handler);
ws.SetAutoReconnect(true, 5000);   // 5s reconnect delay
ws.SetPingInterval(30000);         // ping every 30s
ws.Connect("wss://api.example.com/ws");
```

::: tip
Since v2.0 the WebSocket client owns its HTTP upgrade handshake directly; it no longer depends on `HttpClient` / `HttpClientEventListener`.
:::

## HTTP Server configuration

```cpp
#include "xtils/net/http_server.h"

struct HttpServerConfig {
  // Max HTTP request body size; over the limit returns 413 Payload Too Large.
  size_t max_payload_size = 4 * 1024 * 1024;  // default 4 MB
};

// Default config
HttpServer server(&runner, &handler);

// Custom limit (embedded device, 1 MB)
HttpServerConfig small;
small.max_payload_size = 1 * 1024 * 1024;
HttpServer server2(&runner, &handler, small);

// File upload service (64 MB)
HttpServerConfig big;
big.max_payload_size = 64 * 1024 * 1024;
HttpServer server3(&runner, &handler, big);
```

::: tip
On memory-constrained devices (RAM < 30 MB), set `max_payload_size` explicitly.
:::

### Streaming file responses

`HttpServer::Connection` (a.k.a. `HttpServerConnection`) can chunk a file in 64 KB pieces without loading it fully into memory:

```cpp
bool ok = conn->SendFileStreaming(file_path, "200 OK", headers);
```

## Multipart parser

For uploads and form data:

```cpp
#include "xtils/net/http_multipart.h"

router.Post("/upload",
    [](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
  auto& files  = ctx.GetMultipartFiles();   // parsed on first access
  auto& fields = ctx.GetMultipartFields();

  for (auto& file : files) {
    LogI("file: %s (%zu bytes)", file.filename.c_str(), file.content.size());
  }
  res.Status(200).Json("{\"uploaded\":" + std::to_string(files.size()) + "}");
});
```

## TLS factory

```cpp
#include "xtils/net/transport/tls_factory.h"

TlsContextPtr CreateTlsContext(const TlsCertConfig& cfg);
std::unique_ptr<Transport> CreateTlsTransport(TaskRunner* runner,
                                              TransportEventListener* listener);
```

Backend (OpenSSL or mbedTLS) is selected at compile time with `TLS_BACKEND`.

## IPC channel

`xtils/net/ipc_channel.h` provides JSON-RPC 2.0 over Unix / abstract Unix / TCP. See:

- [IPC Channel (JSON-RPC)](/en/modules/ipc)

## Putting it together

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
        [this](const HttpRouter::Context&, HttpRouter::Response& res) {
      Json status = Json::object();
      status["uptime"]  = GetUptime();
      status["clients"] = ws_clients_;
      res.Status(200).Json(status.dump());
    });

    router_->Static("/", config.GetOr<std::string>("web_root", "./public"));
    router_->EnableCors("*", "GET,POST,OPTIONS");

    handler_ = std::make_unique<RouterHttpRequestHandler>(std::move(router_));
    server_  = std::make_unique<HttpServer>(runner_.get(), handler_.get());
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

::: tip Thread safety
All networking callbacks fire on the TaskRunner's thread. With `ThreadTaskRunner` every callback for the same server runs serialised on its dedicated thread — no locking required inside handlers.
:::
