# Networking

The Networking module provides a complete set of networking primitives: TCP/UDP clients and servers, an HTTP client and server with Express-style routing, WebSocket client with auto-reconnect, multipart form-data parsing, and TLS support via pluggable backends.

## Overview

All networking in xtils is event-driven and non-blocking, built on the `TaskRunner` event loop. Callbacks fire on the event loop thread, making the programming model simple and predictable — no data races by default.

```cpp
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

auto runner = ThreadTaskRunner::CreateAndStart("server");
HttpRouter router;

router.Get("/api/hello", [](const HttpRequestContext& ctx, HttpResponse& res) {
  res.Status(200).Json("{\"message\":\"Hello!\"}");
});

HttpServer server(runner.get(), &router);
server.Start("0.0.0.0", 8080);
```

## TCP Client

```cpp
#include "xtils/net/tcp_client.h"
```

### Event Listener

```cpp
class TcpClientEventListener {
 public:
  virtual void OnConnected(bool success) = 0;
  virtual void OnDataReceived(const void* data, size_t len) = 0;
  virtual void OnDisconnected() = 0;
};
```

### API

```cpp
TcpClient(TaskRunner* runner, TcpClientEventListener* listener);

bool Connect(const std::string& address, uint16_t port);
bool ConnectToHost(const std::string& hostname, uint16_t port);  // DNS resolution
void Disconnect();
bool Send(const void* data, size_t len);
bool SendString(const std::string& data);
bool IsConnected() const;
void SetKeepAlive(bool enable);
void SetNoDelay(bool enable);
```

### Example

```cpp
class MyClient : public TcpClientEventListener {
 public:
  void OnConnected(bool success) override {
    if (success) {
      LogI("Connected!");
      client_->SendString("HELLO\n");
    }
  }
  
  void OnDataReceived(const void* data, size_t len) override {
    std::string msg(static_cast<const char*>(data), len);
    LogI("Received: %s", msg.c_str());
  }
  
  void OnDisconnected() override {
    LogI("Disconnected");
  }

  TcpClient* client_;
};

MyClient listener;
TcpClient client(&runner, &listener);
listener.client_ = &client;
client.ConnectToHost("example.com", 9000);
```

## TCP Server

```cpp
#include "xtils/net/tcp_server.h"
```

### Event Listener

```cpp
class TcpServerEventListener {
 public:
  virtual void OnClientConnected(TcpServerConnection* conn) = 0;
  virtual void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) = 0;
  virtual void OnClientDisconnected(TcpServerConnection* conn) = 0;
};
```

### API

```cpp
TcpServer(TaskRunner* runner, TcpServerEventListener* listener);

bool Start(const std::string& address, uint16_t port);
bool StartDualStack(uint16_t port);  // IPv4 + IPv6
void Stop();
void Broadcast(const void* data, size_t len);
size_t GetConnectionCount() const;
```

### Example: Echo Server

```cpp
class EchoServer : public TcpServerEventListener {
  void OnClientConnected(TcpServerConnection* conn) override {
    LogI("Client connected: %s", conn->GetRemoteAddress().c_str());
  }
  
  void OnDataReceived(TcpServerConnection* conn, const void* data, size_t len) override {
    // Echo back
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

## UDP Client

```cpp
#include "xtils/net/udp_client.h"

UdpClient(TaskRunner* runner, UdpClientEventListener* listener);

bool Open(const std::string& local_address = "", uint16_t local_port = 0);
bool SendTo(const std::string& server_addr, const void* data, size_t len);
bool Send(const void* data, size_t len);
void Close();
void SetBroadcast(bool enable);
bool JoinMulticastGroup(const std::string& group, const std::string& interface = "");
```

## UDP Server

```cpp
#include "xtils/net/udp_server.h"

UdpServer(TaskRunner* runner, UdpServerEventListener* listener);

bool Start(const std::string& address, uint16_t port);
bool StartDualStack(uint16_t port);
bool SendTo(const std::string& client_addr, const void* data, size_t len);
void Broadcast(const void* data, size_t len);
void SetClientTimeout(uint32_t timeout_ms);
```

## HTTP Client

```cpp
#include "xtils/net/http_client.h"
```

### Synchronous API

```cpp
HttpClient client(&runner);

HttpResponse res = client.Get("https://api.example.com/data");
HttpResponse res = client.Post(url, body, "application/json");
HttpResponse res = client.PostJson(url, json_string);
HttpResponse res = client.PostForm(url, {{"key", "value"}});
HttpResponse res = client.PostMultipart(url, fields, files);
HttpResponse res = client.Request(custom_request);
```

### Asynchronous API

```cpp
client.GetAsync(url, [](const HttpResponse& res) {
  LogI("Status: %d, Body: %s", res.status_code, res.body.c_str());
});

client.PostJsonAsync(url, json, [](const HttpResponse& res) { /* ... */ });
client.PostMultipartAsync(url, fields, files, [](const HttpResponse& res) { /* ... */ });
client.RequestAsync(request, [](const HttpResponse& res) { /* ... */ });
```

### Configuration

```cpp
client.SetTimeout(10000);                    // 10 second timeout
client.SetFollowRedirects(true, 5);          // Follow up to 5 redirects
client.SetKeepAlive(true);                   // Reuse connections
client.SetVerifySSL(true);                   // Verify TLS certificates
client.SetSSLCertificate("/path/to/ca.pem"); // Custom CA bundle
client.SetCookie("session", "abc123", ".example.com");
```

### Example: REST Client

```cpp
HttpClient client(&runner);
client.SetTimeout(5000);
client.SetFollowRedirects(true);

// GET with query parameters
auto res = client.Get("https://api.example.com/users?page=1&limit=10");
if (res.status_code == 200) {
  auto users = Json::parse(res.body);
  LogI("Got %d users", (int)users->as_array().size());
}

// POST JSON
Json payload;
payload["name"] = "Alice";
payload["email"] = "alice@example.com";
auto create_res = client.PostJson("https://api.example.com/users", payload.dump());
```

## HTTP Server (Low-Level)

```cpp
#include "xtils/net/http_server.h"
```

### Request Handler Interface

```cpp
class HttpRequestHandler {
 public:
  virtual void OnHttpRequest(const HttpRequest& request) = 0;
  virtual void OnWebsocketMessage(const WebsocketMessage& msg) {}
  virtual void OnHttpConnectionClosed(HttpServerConnection* conn) {}
};
```

### Server API

```cpp
HttpServer(TaskRunner* runner, HttpRequestHandler* handler);

bool Start(const std::string& ip, uint16_t port);
void Stop();
void AddAllowedOrigin(const std::string& origin);
```

### Connection Methods

```cpp
conn->SendResponse(http_code, headers, content, force_close);
conn->UpgradeToWebsocket(request);
conn->SendWebsocketMessage(data, len);
bool conn->SendFileStreaming(file_path, http_code, headers);  // Chunked file delivery
```

## HTTP Router (Express-Style)

The router provides familiar Express.js-style routing with URL parameters, query strings, middleware, and static file serving.

```cpp
#include "xtils/net/http_router.h"
```

### Route Registration

```cpp
HttpRouter router;

router.Get("/api/users", handler);
router.Post("/api/users", handler);
router.Put("/api/users/:id", handler);
router.Delete("/api/users/:id", handler);
router.Any("/api/*", handler);   // Match any method, wildcard path
```

### Handler Signature

```cpp
void handler(const HttpRequestContext& ctx, HttpResponse& res) {
  // URL parameters (from :param patterns)
  auto id = ctx.GetParam("id");
  
  // Query parameters
  auto search = ctx.GetQuery("q");
  auto page = ctx.GetQuery("page");
  
  // Request body
  auto body = ctx.GetBody();
  
  // Headers
  auto auth = ctx.GetHeader("Authorization");
  
  // Multipart form data (lazy parsed)
  auto& fields = ctx.GetMultipartFields();
  auto& files = ctx.GetMultipartFiles();
  
  // Send response
  res.Status(200).Json("{\"ok\":true}");
  res.Status(201).Text("Created");
  res.Status(404).Html("<h1>Not Found</h1>");
}
```

### Middleware

```cpp
// Global middleware (runs for all routes)
router.Use([](const HttpRequestContext& ctx, HttpResponse& res) -> bool {
  LogI("%s %s", ctx.GetMethod().c_str(), ctx.GetPath().c_str());
  return true;  // Continue to next handler (false = abort)
});

// Path-scoped middleware
router.Use("/api", [](const HttpRequestContext& ctx, HttpResponse& res) -> bool {
  auto token = ctx.GetHeader("Authorization");
  if (token.empty()) {
    res.Status(401).Json("{\"error\":\"unauthorized\"}");
    return false;  // Stop chain
  }
  return true;
});
```

### Static File Serving

```cpp
// Serve ./public directory at /static path
router.Static("/static", "./public");

// Serve SPA (fallback to index.html)
router.Static("/", "./dist");
```

### Route Groups

```cpp
auto api = router.Group("/api/v1");
api.Get("/users", listUsers);
api.Post("/users", createUser);
api.Get("/users/:id", getUser);
api.Put("/users/:id", updateUser);
api.Delete("/users/:id", deleteUser);
```

### CORS

```cpp
router.EnableCors("*", "GET,POST,PUT,DELETE,OPTIONS");
// Or specific origins:
router.EnableCors("https://example.com", "GET,POST");
```

## WebSocket Client

```cpp
#include "xtils/net/websocket_client.h"
```

### Event Listener

```cpp
class WebSocketClientEventListener {
 public:
  virtual void OnWebSocketConnected(WebSocketClient* client) = 0;
  virtual void OnWebSocketMessage(WebSocketClient* client, const WebSocketMessage& msg) = 0;
  virtual void OnWebSocketClosed(WebSocketClient* client, uint16_t code, const std::string& reason) = 0;
  virtual void OnWebSocketError(WebSocketClient* client, const std::string& error) = 0;
};
```

### API

```cpp
WebSocketClient(TaskRunner* runner, WebSocketClientEventListener* listener = nullptr);

bool Connect(const std::string& url);
bool Connect(const std::string& url, const std::map<std::string, std::string>& headers);
bool Connect(const std::string& url, const std::map<std::string, std::string>& headers,
             const std::vector<std::string>& protocols);

bool SendText(const std::string& text);
bool SendBinary(const void* data, size_t len);
bool SendPing(const std::string& data = "");
void Close(uint16_t code = 1000, const std::string& reason = "");
```

### Configuration

```cpp
client.SetAutoReconnect(true, 3000);    // Auto-reconnect with 3s delay
client.SetPingInterval(30000);          // Send ping every 30s
client.SetMaxMessageSize(1024 * 1024);  // 1MB max message
client.SetVerifySSL(true);              // Verify TLS for wss://
```

### Example: WebSocket with Auto-Reconnect

```cpp
class WsHandler : public WebSocketClientEventListener {
 public:
  void OnWebSocketConnected(WebSocketClient* client) override {
    LogI("WS connected!");
    client->SendText("{\"type\":\"subscribe\",\"channel\":\"updates\"}");
  }

  void OnWebSocketMessage(WebSocketClient* client, const WebSocketMessage& msg) override {
    if (msg.is_text) {
      auto json = Json::parse(msg.text);
      LogI("Update: %s", json->dump().c_str());
    }
  }

  void OnWebSocketClosed(WebSocketClient* client, uint16_t code, const std::string& reason) override {
    LogW("WS closed: %d %s", code, reason.c_str());
  }

  void OnWebSocketError(WebSocketClient* client, const std::string& error) override {
    LogE("WS error: %s", error.c_str());
  }
};

WsHandler handler;
WebSocketClient ws(&runner, &handler);
ws.SetAutoReconnect(true, 5000);
ws.Connect("wss://api.example.com/ws");
```

## Multipart Parser

For handling file uploads and form data:

```cpp
#include "xtils/net/http_multipart.h"

struct MultipartFormField {
  std::string name;
  std::string value;
};

struct MultipartFormFile {
  std::string field_name;     // Form field name
  std::string filename;       // Original filename
  std::string content_type;   // MIME type
  std::string content;        // File content (binary-safe)
};
```

### Direct Usage

```cpp
auto boundary = MultipartParser::ExtractBoundary(content_type_header);
MultipartParser parser(body, boundary);

if (parser.Parse()) {
  for (auto& field : parser.GetFields()) {
    LogI("Field: %s = %s", field.name.c_str(), field.value.c_str());
  }
  for (auto& file : parser.GetFiles()) {
    LogI("File: %s (%s, %zu bytes)", file.filename.c_str(),
         file.content_type.c_str(), file.content.size());
  }
}
```

### Via Router (Lazy Parsing)

```cpp
router.Post("/upload", [](const HttpRequestContext& ctx, HttpResponse& res) {
  auto& files = ctx.GetMultipartFiles();  // Parsed on first access
  auto& fields = ctx.GetMultipartFields();
  
  for (auto& file : files) {
    save_file(file.filename, file.content);
  }
  res.Status(200).Json("{\"uploaded\":" + std::to_string(files.size()) + "}");
});
```

## TLS Factory

Backend-agnostic TLS support:

```cpp
#include "xtils/net/transport/tls_factory.h"

// Create TLS context (cert/key configuration)
TlsContextPtr CreateTlsContext(const TlsCertConfig& cfg);

// Create TLS transport (wraps a plain TCP connection)
std::unique_ptr<Transport> CreateTlsTransport(TaskRunner* runner,
                                               TransportEventListener* listener);
```

The backend (OpenSSL or mbedTLS) is selected at compile time via `TLS_BACKEND`.

## HTTP Utilities

```cpp
#include "xtils/net/http_common.h"

// URL parsing
HttpUrl url = HttpUrl::Parse("https://example.com:8443/path?q=1");
// url.scheme = "https", url.host = "example.com", url.port = 8443, ...

// URL encoding
std::string encoded = HttpUtils::UrlEncode("hello world");  // "hello%20world"
std::string decoded = HttpUtils::UrlDecode("hello%20world");

// Form encoding
std::string form = HttpUtils::FormDataEncode({{"key", "value"}, {"foo", "bar"}});

// MIME types
std::string mime = HttpUtils::GetMimeType("json");  // "application/json"
```

## Putting It Together

A complete server with REST API, WebSocket, and static files:

```cpp
#include <xtils/app/service.h>
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class WebService : public Service<WebService> {
 public:
  WebService() : Service("web") {}

  void Init() override {
    runner_ = ThreadTaskRunner::CreateAndStart("web_io");
    router_ = std::make_unique<HttpRouter>();

    // REST endpoints
    router_->Get("/api/status", [this](const HttpRequestContext& ctx, HttpResponse& res) {
      Json status;
      status["uptime"] = GetUptime();
      status["clients"] = ws_clients_;
      res.Status(200).Json(status.dump());
    });

    // WebSocket endpoint for live updates
    router_->Get("/ws", [this](const HttpRequestContext& ctx, HttpResponse& res) {
      ws_clients_++;
      res.Status(101);  // Upgrade handled by server
    });

    // Static files
    router_->Static("/", config.GetString("web_root").value_or("./public"));
    router_->EnableCors("*", "GET,POST,OPTIONS");

    server_ = std::make_unique<HttpServer>(runner_.get(), router_.get());
    server_->Start("0.0.0.0", config.GetInt("port").value_or(8080));
  }

  void Deinit() override {
    server_->Stop();
  }

 private:
  ThreadTaskRunner runner_;
  std::unique_ptr<HttpRouter> router_;
  std::unique_ptr<HttpServer> server_;
  int ws_clients_ = 0;
};
```

::: tip Thread Safety
All network callbacks fire on the TaskRunner's thread (the thread that calls `Run()`). If you use `ThreadTaskRunner`, all callbacks for that server are serialized on its dedicated thread — no locks needed within handlers.
:::
