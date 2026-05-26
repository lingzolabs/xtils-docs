# Utilities

The Utils module provides a comprehensive set of general-purpose utilities: a custom JSON implementation, string operations, file I/O, thread-safe containers, RAII wrappers, binary readers/writers, and more.

## Overview

These utilities form the foundation layer of xtils — all other modules depend on them. They're designed to be lightweight, header-friendly, and free of external dependencies.

## JSON

A custom JSON implementation with an intuitive API (no external dependency like nlohmann/json):

```cpp
#include "xtils/utils/json.h"
using namespace xtils;
```

### Construction

```cpp
Json null_val;                      // null
Json bool_val(true);                // boolean
Json int_val(42);                   // integer
Json float_val(3.14);              // float
Json str_val("hello");             // string
Json arr_val(Json::array_t{});     // empty array
Json obj_val(Json::object_t{});    // empty object
```

### Building Objects

```cpp
Json config;
config["server"]["host"] = "0.0.0.0";
config["server"]["port"] = 8080;
config["features"] = Json::array_t{};
config["features"].push_back("http");
config["features"].push_back("websocket");
config["enabled"] = true;

// Serialize
std::string json_str = config.dump(2);  // Pretty-print with 2-space indent
std::string compact = config.dump(0);   // Compact (one-line for small objects)
```

### Parsing

```cpp
// With error code
int error;
Json data = Json::parse(json_string, error);
if (error != 0) { /* handle error */ }

// With optional (returns nullopt on error)
auto data = Json::parse(json_string);
if (data) {
  LogI("Parsed: %s", data->dump().c_str());
}
```

### Access

```cpp
// Type checks
json.is_null(); json.is_bool(); json.is_integer();
json.is_float(); json.is_number(); json.is_string();
json.is_array(); json.is_object();

// Value extraction (throws on type mismatch)
bool b = json.as_bool();
int64_t i = json.as_integer();
double d = json.as_float();
const std::string& s = json.as_string();
const Json::array_t& arr = json.as_array();
const Json::object_t& obj = json.as_object();

// Template access
auto val = json.as<int>();

// Safe access (returns std::optional)
auto port = json.get("port");           // std::optional<Json>
auto host = json.get_string("host");    // std::optional<std::string>
auto count = json.get_integer("count"); // std::optional<int64_t>
auto flag = json.get_bool("enabled");   // std::optional<bool>

// Check existence
json.has_key("port");
json.contains("host");
json.has_index(0);

// Size & iteration
json.size();
json.empty();
for (auto& [key, value] : json.as_object()) { /* ... */ }
for (auto& item : json.as_array()) { /* ... */ }
```

### Mutation

```cpp
json["new_key"] = "value";
json.push_back(Json(42));  // Append to array
json.erase("old_key");     // Remove key
json.erase(0);             // Remove at index
json.clear();              // Reset to null
```

## String Utils

```cpp
#include "xtils/utils/string_utils.h"
```

### Conversion

```cpp
std::optional<uint32_t> StringToUInt32(const std::string& str, int base = 10);
std::optional<int64_t> StringToInt64(const std::string& str, int base = 10);
std::optional<double> StringToDouble(const std::string& str);
```

### String Operations

```cpp
bool StartsWith(const std::string& str, const std::string& prefix);
bool EndsWith(const std::string& str, const std::string& suffix);
bool Contains(const std::string& haystack, const std::string& needle);
bool CaseInsensitiveEqual(const std::string& a, const std::string& b);

std::string Join(const std::vector<std::string>& parts, const std::string& delim);
std::vector<std::string> SplitString(const std::string& text, const std::string& delimiter);

std::string StripPrefix(const std::string& str, const std::string& prefix);
std::string StripSuffix(const std::string& str, const std::string& suffix);
std::string TrimWhitespace(const std::string& str);
std::string ToLower(const std::string& str);
std::string ToUpper(const std::string& str);
std::string ToHex(const void* data, size_t size);
std::string ReplaceAll(const std::string& str, const std::string& from, const std::string& to);
```

### Low-Level

```cpp
// Safe string copy (like strlcpy)
void StringCopy(char* dst, const char* src, size_t dst_size);

// Truncating sprintf
size_t SprintfTrunc(char* dst, size_t dst_size, const char* fmt, ...);

// Stack-allocated formatted string (no heap allocation)
StackString<256> msg("Error %d: %s", code, description);
// Use msg.c_str() or implicit conversion
```

## File Utils

```cpp
#include "xtils/utils/file_utils.h"
// All functions in namespace: file_utils::
```

### Queries

```cpp
bool readable(const std::string& path);
bool writeable(const std::string& path);
bool exists(const std::string& path);
bool is_file(const std::string& path);
bool is_directory(const std::string& path);
size_t file_size(const std::string& path);
```

### Reading

```cpp
// Read entire file into string
bool read(const std::string& path, std::string& out);
bool read(const std::string& path, std::string& out, size_t max_size);

// Read file as lines
bool read_lines(const std::string& path, std::vector<std::string>& out);
```

### Writing

```cpp
bool write(const std::string& path, const std::string& content);
bool append(const std::string& path, const std::string& content);
```

### Directory Operations

```cpp
bool mkdir(const std::string& path);  // Recursive mkdir
std::vector<std::string> list_directory(const std::string& path);  // All entries
std::vector<std::string> list_files(const std::string& path);      // Files only
std::vector<std::string> list_directories(const std::string& path); // Dirs only
```

### File Operations

```cpp
bool copy(const std::string& src, const std::string& dst);
bool move(const std::string& src, const std::string& dst);
bool rename(const std::string& src, const std::string& dst);
bool remove(const std::string& path);
bool remove_all(const std::string& path);  // Recursive delete
```

### Path Manipulation

```cpp
std::string dirname(const std::string& path);
std::string bsname(const std::string& path);    // basename
std::string extension(const std::string& path);
std::string stem(const std::string& path);       // filename without extension
std::string join_path(const std::string& a, const std::string& b);
std::string absolute_path(const std::string& path);
std::string canonical_path(const std::string& path);
std::string current_path();
bool change_directory(const std::string& path);
```

## Thread-Safe Queue

A blocking thread-safe container wrapper:

```cpp
#include "xtils/utils/thread_safe.h"

ThreadSafe<std::list<WorkItem>> queue;

// Producer (any thread)
queue.Push(WorkItem{...});

// Consumer (blocking)
WorkItem item;
if (queue.PopWait(item, std::chrono::seconds(5))) {
  Process(item);
}

// Consumer (non-blocking)
WorkItem item;
if (queue.TryPop(item)) {
  Process(item);
}

// Lifecycle
queue.Size();
queue.Clear();
queue.Quit();  // Unblocks all waiting PopWait calls
```

## WeakPtr (Single-Threaded)

A lightweight weak pointer for preventing dangling callbacks:

```cpp
#include "xtils/utils/weak_ptr.h"

class MyObject {
 public:
  auto GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  
 private:
  WeakPtrFactory<MyObject> weak_factory_{this};
};

// Usage
auto obj = std::make_unique<MyObject>();
auto weak = obj->GetWeakPtr();

// Later (e.g., in a callback)
if (auto* ptr = weak.get()) {
  ptr->DoSomething();  // Safe — object still alive
}

obj.reset();  // Destroy object
// weak.get() now returns nullptr
```

::: tip
`WeakPtr` is single-threaded (no atomic overhead). Use it for preventing use-after-free in callbacks posted to the same event loop. For cross-thread use, use `std::weak_ptr`.
:::

## Scoped RAII

```cpp
#include "xtils/utils/scoped.h"

// Auto-close file descriptor
ScopedFile fd(open("/tmp/data", O_RDONLY));
// fd automatically closed on scope exit

// Auto-close FILE*
ScopedFstream fp(fopen("data.txt", "r"));

// Auto-close DIR*
ScopedDir dir(opendir("/tmp"));

// Generic deferred cleanup
Scoped cleanup([]() {
  LogI("Cleanup on scope exit");
  ReleaseResources();
});
```

## Binary Reader/Writer

Endian-aware binary data handling:

```cpp
#include "xtils/utils/byte_reader.h"
#include "xtils/utils/byte_writer.h"

// Writing
ByteWriter writer;
writer.WriteUInt8(0xFF);
writer.WriteUInt16BE(1024);    // Big-endian
writer.WriteUInt32LE(12345);   // Little-endian
writer.WriteString("hello");
auto data = writer.GetData();  // std::vector<uint8_t>

// Reading
ByteReader reader(data.data(), data.size());
uint8_t byte = reader.ReadUInt8();
uint16_t val = reader.ReadUInt16BE();
uint32_t num = reader.ReadUInt32LE();
std::string str = reader.ReadString(5);
bool ok = reader.HasRemaining(4);  // Check if N bytes available
```

## Other Utilities

| Header | Description |
|--------|-------------|
| `xtils/utils/base64.h` | Base64 encode/decode |
| `xtils/utils/sha1.h` | SHA1 hash (used internally for WebSocket) |
| `xtils/utils/endianness.h` | Byte order detection & conversion macros |
| `xtils/utils/time_utils.h` | `steady::Now()`, `system::GetCurrentUtcMs()`, `common::TimeDiffMs()` |
| `xtils/utils/type_traits.h` | Compile-time `type_name<T>()`, `type_name_cstr<T>()` |
| `xtils/utils/exception.h` | Exception utilities |
| `xtils/utils/string_view.h` | `string_view` helpers |

### Time Utils Example

```cpp
#include "xtils/utils/time_utils.h"

auto start = xtils::steady::Now();
DoWork();
auto elapsed = xtils::common::TimeDiffMs(start, xtils::steady::Now());
LogI("Took %lld ms", elapsed);

uint64_t utc_ms = xtils::system::GetCurrentUtcMs();
```

### Base64 Example

```cpp
#include "xtils/utils/base64.h"

std::string encoded = xtils::Base64Encode("Hello, World!");
std::string decoded = xtils::Base64Decode(encoded);
```
