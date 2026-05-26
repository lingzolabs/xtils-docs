# 快速开始

## 环境要求

- **编译器**：GCC 7+、Clang 5+ 或 MSVC 2017+（需要 C++17 支持）
- **构建系统**：CMake 3.10+
- **TLS 后端**：OpenSSL 1.1+（默认）或 mbedTLS 2.x/3.x
- **操作系统**：Linux（主要）、macOS（部分支持）

## 安装

### 克隆仓库

```bash
git clone https://github.com/lingzolabs/xtils.git
cd xtils
```

### 从源码构建

```bash
# Debug 构建，启用测试和示例
cmake -B build -DCMAKE_BUILD_TYPE=Debug \
  -DBUILD_TESTS=ON \
  -DBUILD_EXAMPLES=ON

cmake --build build -j$(nproc)

# 运行测试
cd build && ctest --output-on-failure
```

### CMake 选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `BUILD_TESTS` | `OFF` | 构建单元测试（需要 doctest，已内置） |
| `BUILD_EXAMPLES` | `OFF` | 构建示例程序 |
| `BUILD_WITH_SANITIZERS` | `OFF` | 启用 AddressSanitizer + UndefinedBehaviorSanitizer |
| `TLS_BACKEND` | `openssl` | TLS 实现：`openssl` 或 `mbedtls` |
| `INSPECT_DISABLE` | `OFF` | 在编译时剥离所有 Inspect 调试服务器代码 |

## 集成方式

### 方式一：`add_subdirectory`（推荐用于 Monorepo）

如果 xtils 作为 git submodule 或与项目同级：

```cmake
cmake_minimum_required(VERSION 3.10)
project(my_app)

# 引入 xtils
add_subdirectory(path/to/xtils)

# 你的目标
add_executable(my_app main.cc)
target_link_libraries(my_app xtils)
```

::: tip
xtils 将 `cxx_std_17` 作为公共编译特性导出 — 你的目标会自动获得 C++17，无需手动设置 `CMAKE_CXX_STANDARD`。
:::

### 方式二：`find_package`（系统安装）

安装 xtils 后：

```bash
cmake -B build -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build build --target install
```

在你的项目中：

```cmake
find_package(xtils REQUIRED)
target_link_libraries(my_app xtils::xtils)
```

### 方式三：FetchContent

```cmake
include(FetchContent)
FetchContent_Declare(xtils
  GIT_REPOSITORY https://github.com/lingzolabs/xtils.git
  GIT_TAG master
)
FetchContent_MakeAvailable(xtils)
target_link_libraries(my_app xtils)
```

## TLS 后端选择

xtils 需要选择一个 TLS 后端以支持 HTTPS 和 WSS：

```bash
# 使用 OpenSSL（默认）
cmake -B build -DTLS_BACKEND=openssl

# 使用 mbedTLS
cmake -B build -DTLS_BACKEND=mbedtls
```

选定的后端会向消费者传播编译定义（`USE_OPENSSL` 或 `USE_MBEDTLS`）。应用代码应使用与后端无关的工厂接口：

```cpp
#include "xtils/net/transport/tls_factory.h"

auto ctx = xtils::CreateTlsContext(cfg);
auto transport = xtils::CreateTlsTransport(runner, listener);
```

## 项目结构

使用 xtils 的典型项目结构：

```
my_project/
├── CMakeLists.txt
├── config.json          # 应用配置
├── src/
│   ├── main.cc          # app_main 入口
│   ├── my_service.h     # Service 实现
│   └── my_service.cc
└── third_party/
    └── xtils/           # git submodule 或 subtree
```

## 第一个应用

### 1. 入口点

xtils 内部提供了 `main()` 函数，你只需实现 `app_main`：

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

### 2. Service 实现

```cpp
// my_service.h
#pragma once
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

class MyService : public xtils::Service<MyService> {
 public:
  MyService() : Service("my_service") {}

  void Init() override {
    LogI("服务已初始化，配置: %s", config.ToString().c_str());
  }

  void Deinit() override {
    LogI("服务正在关闭");
  }
};
```

### 3. 配置文件

创建 `config.json`：

```json
{
  "my_service": {
    "port": 8080,
    "debug": true
  }
}
```

运行：

```bash
./my_app --config-file config.json
```

每个服务自动接收以服务名为 key 的配置段。

## 下一步

- [架构设计](/guide/architecture) — 模块依赖关系和构建系统内部
- [应用框架](/modules/app) — 服务生命周期、事件、定时器详解
- [示例](/examples/robot-vacuum) — 一个完整的实际应用
