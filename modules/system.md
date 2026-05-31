# 系统

System 模块提供操作系统级别的底层原语：信号处理、页对齐内存分配、事件文件描述符、Unix 域套接字和平台抽象。

## 概述

System 模块是 xtils 的基础设施层 — 大部分组件作为内部构建模块被更高级的模块（net、tasks、app）使用。它们被公开暴露以支持高级用例，例如自定义事件循环集成、进程间通信或低级内存管理。

::: warning
大多数应用不需要直接使用 System 模块。优先使用更高级的抽象（如 `TaskRunner`、`HttpServer`、`Service`）。仅在需要精细控制底层行为时才直接使用这些组件。
:::

## 头文件参考

| 头文件 | 描述 |
|--------|------|
| `xtils/system/signal_handler.h` | 信号处理与优雅退出 |
| `xtils/system/paged_memory.h` | 页对齐内存分配（mmap + guard pages） |
| `xtils/system/event_fd.h` | Linux eventfd 跨线程通知 |
| `xtils/system/unix_socket.h` | Unix 域套接字（低级 + 事件驱动） |
| `xtils/system/platform.h` | 平台类型别名与工具函数 |

## SignalHandler — 信号处理

统一的信号处理：优雅退出（SIGINT/SIGTERM）和崩溃处理（SIGSEGV/SIGBUS/SIGABRT 带堆栈跟踪）。

```cpp
#include "xtils/system/signal_handler.h"
using namespace xtils::system;

// Initialize with optional shutdown callback
SignalHandler::Initialize([]() {
  LogI("Shutdown requested, cleaning up...");
  CleanupResources();
});

// Add additional callbacks
SignalHandler::AddShutdownCallback([]() {
  LogI("Flushing logs...");
  FlushLogs();
});

// Check in event loop
while (!SignalHandler::IsShutdownRequested()) {
  ProcessEvents();
}

// Manual trigger (e.g., from admin command)
SignalHandler::Shutdown();

// Restore default handlers when done
SignalHandler::Cleanup();
```

### 堆栈跟踪

崩溃信号（SIGSEGV/SIGBUS/SIGABRT）触发时会自动打印堆栈跟踪。也可手动获取：

```cpp
// Get current stack trace as string
std::string trace = xtils::system::GetStackTrace();
LogI("Current stack:\n%s", trace.c_str());
```

::: tip
`SignalHandler::Initialize()` 应在程序启动时尽早调用。如果使用 `Service` 框架（app 模块），信号处理已自动集成，无需手动调用。
:::

## PagedMemory — 页对齐内存

使用 `mmap(MAP_ANONYMOUS)` 分配页对齐内存，带有 guard pages 防止越界访问。HttpServer 的接收缓冲区内部使用此机制。

```cpp
#include "xtils/system/paged_memory.h"
using namespace xtils::system;

// Basic allocation
PagedMemory mem = PagedMemory::Allocate(4096);
if (mem.IsValid()) {
  void* ptr = mem.Get();
  size_t sz = mem.size();
  memset(ptr, 0, sz);
}

// Allocation that may fail (returns invalid instead of crashing)
PagedMemory buf = PagedMemory::Allocate(1024 * 1024, PagedMemory::kMayFail);
if (!buf.IsValid()) {
  LogW("Failed to allocate 1MB buffer");
  return;
}

// Lazy commit (pages not backed by physical memory until first access)
PagedMemory lazy = PagedMemory::Allocate(64 * 1024, PagedMemory::kDontCommit);

// Hint OS that memory region is no longer needed
mem.AdviseDontNeed(mem.Get(), mem.size());
```

### 特性

- **Guard pages**：分配区域前后各有不可访问的保护页，越界访问立即触发 SIGSEGV
- **Move-only**：不可拷贝，仅支持移动语义
- **自动释放**：析构时自动 `munmap`

::: warning
`PagedMemory::Allocate()` 默认在 OOM 时直接崩溃（打印错误并 abort）。如果需要处理分配失败，请传入 `kMayFail` 标志。
:::

## EventFd — 事件通知

Linux `eventfd` 的封装，用于跨线程信号通知。TaskRunner 内部使用它实现线程唤醒。

```cpp
#include "xtils/system/event_fd.h"
using namespace xtils::system;

EventFd event;

// Get pollable file descriptor (for epoll/poll integration)
PlatformHandle fd = event.fd();

// Signal from any thread (thread-safe)
event.Notify();

// Consume pending notifications (up to 16 per call)
event.Clear();
```

### 典型用法：自定义事件循环集成

```cpp
EventFd wakeup;

// Worker thread
std::thread worker([&]() {
  ProcessData();
  wakeup.Notify();  // Signal main thread
});

// Main thread - poll for wakeup
struct pollfd pfd = {wakeup.fd(), POLLIN, 0};
poll(&pfd, 1, -1);
wakeup.Clear();
LogI("Worker finished");
```

::: tip
`EventFd` 的文件描述符可直接加入 `epoll` 或传给 `TaskRunner::AddFileDescriptorWatch()` 监听。
:::

## UnixSocket — Unix 域套接字

两层抽象：`UnixSocketRaw`（低级阻塞/非阻塞 API）和 `UnixSocket`（高级事件驱动，与 TaskRunner 集成）。

### 支持的地址族和类型

| 地址族 | 描述 |
|--------|------|
| `AF_UNIX` | Unix 域（文件路径或 abstract namespace） |
| `AF_INET` | IPv4 |
| `AF_INET6` | IPv6 |

| Socket 类型 | 描述 |
|-------------|------|
| `SockType::kStream` | 流式（TCP 语义） |
| `SockType::kDgram` | 数据报 |
| `SockType::kSeqPacket` | 有序数据包 |

### 事件驱动 API（UnixSocket）

```cpp
#include "xtils/system/unix_socket.h"
using namespace xtils::system;

class MyHandler : public UnixSocket::EventListener {
  void OnNewIncomingConnection(UnixSocket* self,
                                std::unique_ptr<UnixSocket> conn) override {
    LogI("New client connected");
    clients_.push_back(std::move(conn));
  }

  void OnConnect(UnixSocket* self, bool connected) override {
    LogI("Connected: %d", connected);
  }

  void OnDisconnect(UnixSocket* self) override {
    LogI("Peer disconnected");
  }

  void OnDataAvailable(UnixSocket* self) override {
    char buf[4096];
    size_t n = self->Receive(buf, sizeof(buf));
    // Process data...
  }
};

MyHandler handler;
TaskRunner* runner = GetTaskRunner();

// Server: listen on Unix domain socket
UnixSocket::Listen("/tmp/my_app.sock", &handler, runner,
                   SockFamily::kUnix, SockType::kStream);

// Client: connect
UnixSocket::Connect("/tmp/my_app.sock", &handler, runner,
                    SockFamily::kUnix, SockType::kStream);

// Wrap existing connected fd
UnixSocket::AdoptConnected(existing_fd, &handler, runner,
                           SockFamily::kUnix, SockType::kStream);
```

### 特性

- **O_CLOEXEC**：所有创建的文件描述符默认带 close-on-exec 标志
- **SIGPIPE 抑制**：写入已断开的连接不会触发 SIGPIPE
- **Partial write 处理**：自动处理部分写入
- **SCM_RIGHTS**：支持通过 Unix 域套接字传递文件描述符

::: tip
`UnixSocket` 是 `TcpClient`/`TcpServer` 和 `HttpServer` 的内部传输层。一般应用应优先使用 net 模块的高级 API。直接使用 `UnixSocket` 适用于 IPC、自定义协议或需要 fd passing 的场景。
:::

## Platform — 平台抽象

提供平台相关的类型别名和工具函数：

```cpp
#include "xtils/system/platform.h"
using namespace xtils::system;
```

### 类型别名

```cpp
using PlatformHandle = int;         // File descriptor
using SocketHandle = int;           // Socket descriptor
using PlatformThreadId = pid_t;     // OS-level thread ID
using ThreadID = pthread_t;         // POSIX thread ID
using TimeMillis = std::chrono::milliseconds;
```

### 工具函数

```cpp
// Get current thread ID (via syscall, suitable for logging)
PlatformThreadId tid = GetThreadId();

// Get monotonic wall time in milliseconds
TimeMillis now = GetWallTimeMs();

// Set thread name (truncated to 15 chars per POSIX limit)
bool ok = MaybeSetThreadName("worker_thread");
```

### 示例：线程标识与计时

```cpp
#include "xtils/system/platform.h"
using namespace xtils::system;

void WorkerEntry() {
  MaybeSetThreadName("io_worker");
  auto start = GetWallTimeMs();

  DoWork();

  auto elapsed = GetWallTimeMs() - start;
  LogI("[tid=%d] Work done in %lld ms", GetThreadId(), elapsed.count());
}
```

## 完整示例

一个使用 System 模块组件构建的自定义事件驱动 IPC 服务器：

```cpp
#include <xtils/system/signal_handler.h>
#include <xtils/system/event_fd.h>
#include <xtils/system/unix_socket.h>
#include <xtils/system/platform.h>
#include <xtils/system/paged_memory.h>
#include <xtils/tasks/thread_task_runner.h>
#include <xtils/logging/logger.h>

using namespace xtils;
using namespace xtils::system;

class IpcServer : public UnixSocket::EventListener {
 public:
  IpcServer(TaskRunner* runner) : runner_(runner) {
    // Allocate receive buffer with guard pages
    buffer_ = PagedMemory::Allocate(64 * 1024);
  }

  void Start(const std::string& path) {
    UnixSocket::Listen(path, this, runner_,
                       SockFamily::kUnix, SockType::kStream);
    LogI("[tid=%d] IPC server listening on %s",
         GetThreadId(), path.c_str());
  }

  void OnNewIncomingConnection(UnixSocket* self,
                                std::unique_ptr<UnixSocket> conn) override {
    LogI("New IPC client connected");
    clients_.push_back(std::move(conn));
  }

  void OnDataAvailable(UnixSocket* self) override {
    char* buf = static_cast<char*>(buffer_.Get());
    size_t n = self->Receive(buf, buffer_.size());
    if (n > 0) {
      ProcessCommand(std::string_view(buf, n));
    }
  }

  void OnDisconnect(UnixSocket* self) override {
    LogI("IPC client disconnected");
    clients_.erase(
      std::remove_if(clients_.begin(), clients_.end(),
        [self](const auto& c) { return c.get() == self; }),
      clients_.end());
  }

 private:
  void ProcessCommand(std::string_view cmd) {
    LogI("Received command: %.*s", (int)cmd.size(), cmd.data());
  }

  TaskRunner* runner_;
  PagedMemory buffer_;
  std::vector<std::unique_ptr<UnixSocket>> clients_;
};

int main() {
  // Install signal handlers for graceful shutdown
  SignalHandler::Initialize([]() {
    LogI("Shutting down IPC server...");
  });

  MaybeSetThreadName("main");

  auto runner = ThreadTaskRunner::CreateAndStart("ipc_io");
  IpcServer server(runner.get());

  runner.PostTask([&]() {
    server.Start("/tmp/my_app.sock");
  });

  // Wait for shutdown signal
  while (!SignalHandler::IsShutdownRequested()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  LogI("Goodbye");
  SignalHandler::Cleanup();
  return 0;
}
```

::: tip
此示例展示了 System 模块各组件的协作方式。在生产环境中，建议使用 `Service` 框架（app 模块）来管理生命周期，它已内置信号处理、配置加载和优雅退出。
:::
