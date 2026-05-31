# 通用工具

Utils 模块提供一整套通用工具：自定义 JSON 实现、字符串操作、文件 I/O、线程安全容器、RAII 包装器、二进制读写器等。

## 概述

这些工具构成 xtils 的基础层 — 所有其他模块都依赖于它们。它们设计为轻量级、对头文件友好且无外部依赖。

## JSON

自定义 JSON 实现，API 直观（无需 nlohmann/json 等外部依赖）：

```cpp
#include "xtils/utils/json.h"
using namespace xtils;
```

### 构造

```cpp
Json null_val;                      // null
Json bool_val(true);                // boolean
Json int_val(42);                   // integer
Json float_val(3.14);              // float
Json str_val("hello");             // string
Json arr_val(Json::array_t{});     // 空数组
Json obj_val(Json::object_t{});    // 空对象
```

### 构建对象

```cpp
Json config;
config["server"]["host"] = "0.0.0.0";
config["server"]["port"] = 8080;
config["features"] = Json::array_t{};
config["features"].push_back("http");
config["enabled"] = true;

std::string json_str = config.dump(2);  // 美化打印，2 空格缩进
std::string compact = config.dump(0);   // 紧凑格式
```

### 解析

```cpp
// 带错误码
int error;
Json data = Json::parse(json_string, error);

// 使用 optional
auto data = Json::parse(json_string);
if (data) {
  LogI("已解析: %s", data->dump().c_str());
}
```

### 访问

```cpp
// 类型检查
json.is_null(); json.is_bool(); json.is_integer();
json.is_string(); json.is_array(); json.is_object();

// 值提取（类型不匹配时抛异常）
bool b = json.as_bool();
int64_t i = json.as_integer();
const std::string& s = json.as_string();

// 零拷贝快速访问（返回 const Json*，不存在则 nullptr）
const Json* port = json.find("port");    // 比 get() 快 ~3.4x
const Json* item = json.find(0);         // 按索引查找数组元素
if (port && port->is_integer()) {
  int64_t p = port->as_integer();
}

// 安全访问（返回 std::optional，有拷贝开销）
auto port_opt = json.get("port");
auto host = json.get_string("host");
auto count = json.get_integer("count");

// 检查存在性
json.has_key("port");
json.contains("host");
```

### 修改

```cpp
json["new_key"] = "value";
json.push_back(Json(42));  // 追加到数组
json.erase("old_key");
json.clear();
```

## 字符串工具

```cpp
#include "xtils/utils/string_utils.h"

bool StartsWith(str, prefix);
bool EndsWith(str, suffix);
bool Contains(haystack, needle);
std::string Join(parts, delim);
std::vector<std::string> SplitString(text, delimiter);
std::string TrimWhitespace(str);
std::string ToLower(str);
std::string ToUpper(str);
std::string ReplaceAll(str, from, to);
std::string ToHex(data, size);

// 类型转换
std::optional<int64_t> StringToInt64(str, base = 10);
std::optional<double> StringToDouble(str);

// 栈分配格式化字符串（零堆分配）
StackString<256> msg("Error %d: %s", code, description);
```

## 文件工具

```cpp
#include "xtils/utils/file_utils.h"
// 命名空间: file_utils::

// 查询
bool exists(path); bool is_file(path); bool is_directory(path);
size_t file_size(path);

// 读取
bool read(path, out_string);
bool read_lines(path, out_vec);

// 写入
bool write(path, content);
bool append(path, content);

// 目录操作
bool mkdir(path);  // 递归创建
std::vector<std::string> list_files(path);
std::vector<std::string> list_directories(path);

// 文件操作
bool copy(src, dst); bool move(src, dst);
bool remove(path); bool remove_all(path);

// 路径操作
std::string dirname(path); std::string extension(path);
std::string join_path(a, b); std::string absolute_path(path);
```

## 线程安全队列

```cpp
#include "xtils/utils/thread_safe.h"

ThreadSafe<std::list<WorkItem>> queue;

// 生产者（任何线程）
queue.Push(WorkItem{...});

// 消费者（阻塞）
WorkItem item;
if (queue.PopWait(item, std::chrono::seconds(5))) {
  Process(item);
}

// 消费者（非阻塞）
if (queue.TryPop(item)) {
  Process(item);
}

queue.Quit();  // 解除所有等待中的 PopWait 调用
```

## WeakPtr（单线程）

轻量级弱指针，用于防止悬空回调：

```cpp
#include "xtils/utils/weak_ptr.h"

class MyObject {
  auto GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
 private:
  WeakPtrFactory<MyObject> weak_factory_{this};
};

auto obj = std::make_unique<MyObject>();
auto weak = obj->GetWeakPtr();

if (auto* ptr = weak.get()) {
  ptr->DoSomething();  // 安全 — 对象仍然存活
}

obj.reset();
// weak.get() 现在返回 nullptr
```

::: tip
`WeakPtr` 是单线程的（无原子开销）。用于防止同一事件循环上回调的 use-after-free。跨线程使用请用 `std::weak_ptr`。
:::

## Scoped RAII

```cpp
#include "xtils/utils/scoped.h"

ScopedFile fd(open("/tmp/data", O_RDONLY));     // 自动关闭 fd
ScopedFstream fp(fopen("data.txt", "r"));       // 自动关闭 FILE*
ScopedDir dir(opendir("/tmp"));                 // 自动关闭 DIR*

Scoped cleanup([]() { ReleaseResources(); });   // 通用延迟清理
```

## 二进制读写器

端序感知的二进制数据处理：

```cpp
#include "xtils/utils/byte_reader.h"
#include "xtils/utils/byte_writer.h"

// 写入
ByteWriter writer;
writer.WriteUInt8(0xFF);
writer.WriteUInt16BE(1024);    // 大端
writer.WriteUInt32LE(12345);   // 小端
writer.WriteString("hello");
auto data = writer.GetData();

// 读取
ByteReader reader(data.data(), data.size());
uint8_t byte = reader.ReadUInt8();
uint16_t val = reader.ReadUInt16BE();
std::string str = reader.ReadString(5);
```

## 其他工具

| 头文件 | 描述 |
|--------|------|
| `xtils/utils/base64.h` | Base64 编码/解码 |
| `xtils/utils/sha1.h` | SHA1 哈希 |
| `xtils/utils/endianness.h` | 字节序检测与转换 |
| `xtils/utils/time_utils.h` | `steady::Now()`、`system::GetCurrentUtcMs()` |
| `xtils/utils/type_traits.h` | 编译时 `type_name<T>()` |
