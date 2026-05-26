# 网络

Networking 模块提供完整的网络原语集：TCP/UDP 客户端和服务器、带 Express 风格路由的 HTTP 客户端和服务器、支持自动重连的 WebSocket 客户端、multipart form-data 解析和 TLS 支持。

## 概述

xtils 中的所有网络操作都是事件驱动和非阻塞的，构建在 `TaskRunner` 事件循环之上。回调在事件循环线程上触发，使编程模型简单可预测 — 默认无数据竞争。

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

// 同步 API
HttpResponse res = client.Get("https://api.example.com/data");
HttpResponse res = client.PostJson(url, json_string);
HttpResponse res = client.PostForm(url, {{"key", "value"}});
HttpResponse res = client.PostMultipart(url, fields, files);

// 异步 API
client.GetAsync(url, [](const HttpResponse& res) {
  LogI("状态: %d", res.status_code);
});

// 配置
client.SetTimeout(10000);
client.SetFollowRedirects(true, 5);
client.SetKeepAlive(true);
client.SetVerifySSL(true);
```

## HTTP 路由（Express 风格）

路由器提供类似 Express.js 的路由方式，支持 URL 参数、查询字符串、中间件和静态文件服务。

```cpp
#include "xtils/net/http_router.h"

HttpRouter router;

// 路由注册
router.Get("/api/users", handler);
router.Post("/api/users", handler);
router.Put("/api/users/:id", handler);
router.Delete("/api/users/:id", handler);

// 处理器签名
void handler(const HttpRequestContext& ctx, HttpResponse& res) {
  auto id = ctx.GetParam("id");       // URL 参数
  auto q = ctx.GetQuery("search");    // 查询参数
  auto body = ctx.GetBody();          // 请求体
  auto auth = ctx.GetHeader("Authorization");
  
  res.Status(200).Json("{\"ok\":true}");
}
```

### 中间件

```cpp
// 全局中间件
router.Use([](const HttpRequestContext& ctx, HttpResponse& res) -> bool {
  LogI("%s %s", ctx.GetMethod().c_str(), ctx.GetPath().c_str());
  return true;  // 继续（false = 中止）
});

// 路径限定中间件
router.Use("/api", [](const HttpRequestContext& ctx, HttpResponse& res) -> bool {
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
api.Get("/users", listUsers);
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

## Multipart 解析

处理文件上传和表单数据：

```cpp
#include "xtils/net/http_multipart.h"

// 通过路由器（延迟解析）
router.Post("/upload", [](const HttpRequestContext& ctx, HttpResponse& res) {
  auto& files = ctx.GetMultipartFiles();   // 首次访问时解析
  auto& fields = ctx.GetMultipartFields();
  
  for (auto& file : files) {
    LogI("文件: %s (%zu 字节)", file.filename.c_str(), file.content.size());
  }
  res.Status(200).Json("{\"uploaded\":" + std::to_string(files.size()) + "}");
});
```

## TLS 工厂

与后端无关的 TLS 支持：

```cpp
#include "xtils/net/transport/tls_factory.h"

TlsContextPtr CreateTlsContext(const TlsCertConfig& cfg);
std::unique_ptr<Transport> CreateTlsTransport(TaskRunner* runner,
                                               TransportEventListener* listener);
```

后端（OpenSSL 或 mbedTLS）在编译时通过 `TLS_BACKEND` 选择。

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

    router_->Get("/api/status", [this](const HttpRequestContext& ctx, HttpResponse& res) {
      Json status;
      status["uptime"] = GetUptime();
      status["clients"] = ws_clients_;
      res.Status(200).Json(status.dump());
    });

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

::: tip 线程安全
所有网络回调在 TaskRunner 的线程上触发。如果使用 `ThreadTaskRunner`，该服务器的所有回调都在其专用线程上串行化 — 处理器内无需加锁。
:::
