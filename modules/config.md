# 配置管理

Config 模块提供基于 JSON 的配置系统，支持 CLI 参数解析、点分路径访问、类型安全的取值方法和验证。它与 App 框架集成，自动为每个服务提供独立的配置段。

## 概述

配置工作流遵循 **定义 → 加载 → 访问** 的模式：

1. **定义**预期的选项，包括类型、描述和默认值
2. 从 JSON 文件和/或 CLI 参数**加载**（CLI 覆盖文件）
3. 使用类型安全的 getter 和点分路径**访问**值

```cpp
#include <xtils/config/config.h>
using namespace xtils;

Config config;

// 1. 定义选项
config.Define("server.host", "绑定地址", std::string("0.0.0.0"));
config.Define("server.port", "监听端口", int64_t(8080));
config.Define<bool>("server.ssl", "启用 TLS", false);
config.Define<std::string>("database.url", "数据库连接字符串", "", true);  // 必填

// 2. 加载
config.ParseArgs(argc, argv);  // 自动处理 --config-file

// 3. 访问
auto host = config.GetString("server.host").value_or("0.0.0.0");
auto port = config.GetInt("server.port").value_or(8080);
```

## 头文件

```cpp
#include "xtils/config/config.h"
```

## 定义选项

```cpp
Config& Define(const std::string& name, const std::string& description,
               const Json& default_value, bool required = false);

template <typename T>
Config& Define(const std::string& name, const std::string& description,
               T default_value, bool required = false);
```

支持的类型：`std::string`、`int64_t`、`double`、`bool`、`vector<int64_t>`、`vector<double>`、`vector<string>`、`vector<int>`、`vector<float>`、`Json`。

## 加载

```cpp
bool ParseArgs(int argc, const char** argv, bool allow_exit = false);
bool ParseArgs(const std::vector<std::string>& args, bool allow_exit = false);
bool LoadFile(const std::string& filename);
bool ParseJson(const Json& json);
bool Parse(const std::string& json_content);
```

::: tip
`ParseArgs` 会自动处理 `--config-file <path>` — 先加载 JSON 文件，然后将 CLI 参数作为覆盖值应用。
:::

## 访问（点分路径）

```cpp
std::optional<std::string> GetString(const std::string& path) const;
std::optional<int64_t> GetInt(const std::string& path) const;
std::optional<double> GetDouble(const std::string& path) const;
std::optional<bool> GetBool(const std::string& path) const;
std::optional<Json> Get(const std::string& path) const;
template <typename T>
std::optional<T> Get(const std::string& path) const;
bool Has(const std::string& path) const;
```

点分路径可遍历嵌套 JSON 对象：

```cpp
// 给定: {"server": {"tls": {"cert": "/path/to/cert.pem"}}}
auto cert = config.GetString("server.tls.cert");  // → "/path/to/cert.pem"
```

## 修改

```cpp
void Set(const std::string& path, const Json& value);
template <typename T>
void Set(const std::string& path, const T& value);
```

## 验证与帮助

```cpp
bool Validate() const;                              // 检查是否所有必填项都存在
std::vector<std::string> MissingRequired() const;   // 缺失的必填字段列表
std::string Help() const;                           // 生成帮助文本
```

## 序列化

```cpp
std::string ToString() const;
Json ToJson() const;
bool Save(const std::string& filename) const;
void Print() const;
```

## 与 App 框架集成

使用 App 框架时，每个服务自动接收以其名称为 key 的配置段：

```json
{
  "api": {
    "port": 8080,
    "cors_origin": "*"
  },
  "database": {
    "host": "localhost",
    "port": 5432
  }
}
```

```cpp
class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  void Init() override {
    // `config` 已预填充 "api" 段
    auto port = config.GetInt("port").value_or(8080);
    auto cors = config.GetString("cors_origin").value_or("*");
  }
};
```

## 完整示例

```cpp
#include <xtils/config/config.h>
#include <xtils/logging/logger.h>

using namespace xtils;

int main(int argc, char** argv) {
  Config config;
  
  config.Define("server.host", "服务器绑定地址", std::string("0.0.0.0"));
  config.Define("server.port", "服务器端口", int64_t(8080));
  config.Define<bool>("server.ssl", "启用 SSL/TLS", false);
  config.Define<std::string>("database.url", "数据库连接 URL", "", true);
  config.Define("workers", "工作线程数", int64_t(4));

  config.ParseArgs(argc, const_cast<const char**>(argv));

  if (!config.Validate()) {
    auto missing = config.MissingRequired();
    for (auto& m : missing) {
      LogE("缺少必填配置: %s", m.c_str());
    }
    LogI("\n%s", config.Help().c_str());
    return 1;
  }

  auto host = config.GetString("server.host").value_or("0.0.0.0");
  auto port = config.GetInt("server.port").value_or(8080);
  LogI("在 %s:%lld 上启动服务器", host.c_str(), port);

  config.Set("server.started_at", Json(time(nullptr)));
  config.Save("runtime_config.json");
  
  return 0;
}
```
