# Getting Started

## Prerequisites

- **Compiler**: GCC 7+, Clang 5+, or MSVC 2017+ (C++17 support required)
- **Build system**: CMake 3.10+
- **TLS backend**: OpenSSL 1.1+ (default) or mbedTLS 2.x/3.x
- **OS**: Linux (primary), macOS (partial)

## Installation

### Clone the Repository

```bash
git clone https://github.com/lingzolabs/xtils.git
cd xtils
```

### Build from Source

```bash
# Debug build with tests and examples
cmake -B build -DCMAKE_BUILD_TYPE=Debug \
  -DBUILD_TESTS=ON \
  -DBUILD_EXAMPLES=ON

cmake --build build -j$(nproc)

# Run tests
cd build && ctest --output-on-failure
```

### CMake Options

| Option | Default | Description |
|--------|---------|-------------|
| `BUILD_TESTS` | `OFF` | Build unit tests (requires doctest, vendored) |
| `BUILD_EXAMPLES` | `OFF` | Build example programs |
| `BUILD_WITH_SANITIZERS` | `OFF` | Enable AddressSanitizer + UndefinedBehaviorSanitizer |
| `TLS_BACKEND` | `openssl` | TLS implementation: `openssl` or `mbedtls` |
| `INSPECT_DISABLE` | `OFF` | Strip all Inspect debug server code at compile time |

## Integration

### Method 1: `add_subdirectory` (Recommended for Monorepos)

If xtils lives alongside your project (or as a git submodule):

```cmake
cmake_minimum_required(VERSION 3.10)
project(my_app)

# Include xtils
add_subdirectory(path/to/xtils)

# Your target
add_executable(my_app main.cc)
target_link_libraries(my_app xtils)
```

::: tip
xtils exports `cxx_std_17` as a public compile feature — your target automatically gets C++17 without manually setting `CMAKE_CXX_STANDARD`.
:::

### Method 2: `find_package` (System Install)

After installing xtils:

```bash
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build build --target install
```

In your project:

```cmake
find_package(xtils REQUIRED)
target_link_libraries(my_app xtils::xtils)
```

### Method 3: FetchContent

```cmake
include(FetchContent)
FetchContent_Declare(xtils
  GIT_REPOSITORY https://github.com/lingzolabs/xtils.git
  GIT_TAG master
)
FetchContent_MakeAvailable(xtils)
target_link_libraries(my_app xtils)
```

## TLS Backend Selection

xtils requires exactly one TLS backend for HTTPS and WSS support:

```bash
# Use OpenSSL (default)
cmake -B build -DTLS_BACKEND=openssl

# Use mbedTLS
cmake -B build -DTLS_BACKEND=mbedtls
```

The selected backend propagates a compile definition (`USE_OPENSSL` or `USE_MBEDTLS`) to consumers. Your application code should use the backend-agnostic factory:

```cpp
#include "xtils/net/transport/tls_factory.h"

auto ctx = xtils::CreateTlsContext(cfg);
auto transport = xtils::CreateTlsTransport(runner, listener);
```

## Project Structure

A typical project using xtils looks like:

```
my_project/
├── CMakeLists.txt
├── config.json          # App configuration
├── src/
│   ├── main.cc          # app_main entry point
│   ├── my_service.h     # Service implementation
│   └── my_service.cc
└── third_party/
    └── xtils/           # git submodule or subtree
```

## Your First Application

### 1. Entry Point

xtils provides a `main()` function internally. You implement `app_main`:

```cpp
// main.cc
#include <xtils/app/service.h>
#include "my_service.h"

void app_version(uint32_t& major, uint32_t& minor, uint32_t& patch) {
  major = 1; minor = 0; patch = 0;
}

void app_main(xtils::App& app, const std::vector<std::string>& args) {
  app.Register(std::make_shared<MyService>());
}
```

### 2. Service Implementation

```cpp
// my_service.h
#pragma once
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

class MyService : public xtils::Service<MyService> {
 public:
  MyService() : Service("my_service") {}

  void Init() override {
    LogI("Service initialized with config: %s", config.ToString().c_str());
  }

  void Deinit() override {
    LogI("Service shutting down");
  }
};
```

### 3. Configuration

Create `config.json`:

```json
{
  "my_service": {
    "port": 8080,
    "debug": true
  }
}
```

Run with:

```bash
./my_app --config-file config.json
```

Each service automatically receives its own config section (keyed by service name).

## Next Steps

- [Architecture](/en/guide/architecture) — Module dependencies and build system internals
- [App Framework](/en/modules/app) — Service lifecycle, events, timers in detail
- [Examples](/en/examples/robot-vacuum) — A complete real-world application
