# System

The System module provides OS-level primitives: signal handling, page-aligned memory allocation, event file descriptors, Unix domain sockets, and platform abstractions.

## Overview

The System module is xtils's infrastructure layer — most components serve as internal building blocks used by higher-level modules (net, tasks, app). They are publicly exposed to support advanced use cases such as custom event loop integration, inter-process communication, or low-level memory management.

::: warning
Most applications don't need to use the System module directly. Prefer higher-level abstractions (e.g., `TaskRunner`, `HttpServer`, `Service`). Only use these components directly when you need fine-grained control over underlying behavior.
:::

## Header Reference

| Header | Description |
|--------|-------------|
| `xtils/system/signal_handler.h` | Signal handling and graceful shutdown |
| `xtils/system/paged_memory.h` | Page-aligned memory allocation (mmap + guard pages) |
| `xtils/system/event_fd.h` | Linux eventfd cross-thread notification |
| `xtils/system/unix_socket.h` | Unix domain sockets (low-level + event-driven) |
| `xtils/system/platform.h` | Platform type aliases and utility functions |

## SignalHandler — Signal Handling

Unified signal handling: graceful shutdown (SIGINT/SIGTERM) and crash handling (SIGSEGV/SIGBUS/SIGABRT with stack traces).

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

### Stack Traces

Crash signals (SIGSEGV/SIGBUS/SIGABRT) automatically print a stack trace. You can also retrieve one manually:

```cpp
// Get current stack trace as string
std::string trace = xtils::system::GetStackTrace();
LogI("Current stack:\n%s", trace.c_str());
```

::: tip
`SignalHandler::Initialize()` should be called as early as possible during program startup. If you use the `Service` framework (app module), signal handling is already integrated automatically — no manual call needed.
:::

## PagedMemory — Page-Aligned Memory

Uses `mmap(MAP_ANONYMOUS)` to allocate page-aligned memory with guard pages to prevent out-of-bounds access. The HttpServer's receive buffers use this mechanism internally.

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

### Features

- **Guard pages**: Inaccessible protection pages before and after the allocated region; out-of-bounds access immediately triggers SIGSEGV
- **Move-only**: Not copyable, only supports move semantics
- **Automatic deallocation**: Automatically `munmap`s on destruction

::: warning
`PagedMemory::Allocate()` crashes by default on OOM (prints an error and aborts). If you need to handle allocation failure, pass the `kMayFail` flag.
:::

## EventFd — Event Notification

A wrapper around Linux `eventfd`, used for cross-thread signal notification. TaskRunner uses it internally to implement thread wakeup.

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

### Typical Usage: Custom Event Loop Integration

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
The `EventFd` file descriptor can be directly added to `epoll` or passed to `TaskRunner::AddFileDescriptorWatch()` for monitoring.
:::

## UnixSocket — Unix Domain Sockets

Two layers of abstraction: `UnixSocketRaw` (low-level blocking/non-blocking API) and `UnixSocket` (high-level event-driven, integrated with TaskRunner).

### Supported Address Families and Types

| Address Family | Description |
|----------------|-------------|
| `AF_UNIX` | Unix domain (file path or abstract namespace) |
| `AF_INET` | IPv4 |
| `AF_INET6` | IPv6 |

| Socket Type | Description |
|-------------|-------------|
| `SockType::kStream` | Stream (TCP semantics) |
| `SockType::kDgram` | Datagram |
| `SockType::kSeqPacket` | Sequenced packet |

### Event-Driven API (UnixSocket)

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

### Features

- **O_CLOEXEC**: All created file descriptors have close-on-exec set by default
- **SIGPIPE suppression**: Writing to a disconnected connection won't trigger SIGPIPE
- **Partial write handling**: Automatically handles partial writes
- **SCM_RIGHTS**: Supports passing file descriptors over Unix domain sockets

::: tip
`UnixSocket` is the internal transport layer for `TcpClient`/`TcpServer` and `HttpServer`. Most applications should prefer the high-level APIs from the net module. Use `UnixSocket` directly for IPC, custom protocols, or scenarios requiring fd passing.
:::

## Platform — Platform Abstractions

Provides platform-specific type aliases and utility functions:

```cpp
#include "xtils/system/platform.h"
using namespace xtils::system;
```

### Type Aliases

```cpp
using PlatformHandle = int;         // File descriptor
using SocketHandle = int;           // Socket descriptor
using PlatformThreadId = pid_t;     // OS-level thread ID
using ThreadID = pthread_t;         // POSIX thread ID
using TimeMillis = std::chrono::milliseconds;
```

### Utility Functions

```cpp
// Get current thread ID (via syscall, suitable for logging)
PlatformThreadId tid = GetThreadId();

// Get monotonic wall time in milliseconds
TimeMillis now = GetWallTimeMs();

// Set thread name (truncated to 15 chars per POSIX limit)
bool ok = MaybeSetThreadName("worker_thread");
```

### Example: Thread Identification and Timing

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

## Complete Example

A custom event-driven IPC server built using System module components:

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
This example demonstrates how System module components work together. In production, it's recommended to use the `Service` framework (app module) to manage lifecycle — it already includes signal handling, configuration loading, and graceful shutdown.
:::
