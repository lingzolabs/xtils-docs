# Config

The Config module provides JSON-backed configuration with CLI argument parsing, dot-notation path access, type-safe getters, and validation. It integrates with the App framework to provide per-service config sections automatically.

## Overview

The configuration workflow follows a **define → load → access** pattern:

1. **Define** expected options with types, descriptions, and defaults
2. **Load** from JSON files and/or CLI arguments (CLI overrides file)
3. **Access** values with type-safe getters and dot-notation paths

```cpp
#include <xtils/config/config.h>
using namespace xtils;

Config config;

// 1. Define options
config.Define("server.host", "Bind address", std::string("0.0.0.0"));
config.Define("server.port", "Listen port", int64_t(8080));
config.Define<bool>("server.ssl", "Enable TLS", false);
config.Define<std::string>("database.url", "DB connection string", "", true);  // required

// 2. Load
config.ParseArgs(argc, argv);  // handles --config-file automatically

// 3. Access
auto host = config.GetString("server.host").value_or("0.0.0.0");
auto port = config.GetInt("server.port").value_or(8080);
auto ssl = config.GetBool("server.ssl").value_or(false);
```

## Header

```cpp
#include "xtils/config/config.h"
```

## Define Options

```cpp
// Generic define (type inferred from default value)
Config& Define(const std::string& name, const std::string& description,
               const Json& default_value, bool required = false);

// Type-explicit define
template <typename T>
Config& Define(const std::string& name, const std::string& description,
               T default_value, bool required = false);
```

Supported types: `std::string`, `int64_t`, `double`, `bool`, `vector<int64_t>`, `vector<double>`, `vector<string>`, `vector<int>`, `vector<float>`, `Json`.

## Loading

```cpp
// From CLI arguments
bool ParseArgs(int argc, const char** argv, bool allow_exit = false);
bool ParseArgs(const std::vector<std::string>& args, bool allow_exit = false);

// From JSON file
bool LoadFile(const std::string& filename);

// From JSON object or string
bool ParseJson(const Json& json);
bool Parse(const std::string& json_content);

// From environment variables (see below)
size_t LoadEnv(const std::string& prefix);
```

::: tip
`ParseArgs` automatically handles `--config-file <path>` — it loads the JSON file first, then applies CLI arguments as overrides.
:::

### Short flags (-x)

Attach a single-character short alias to an already-defined option:

```cpp
config.Define("server.port", "Listen port", int64_t(8080));
config.Short("server.port", "p");

// Run: ./app -p 9000
//   equivalent to --server.port 9000
```

`Short()` always targets the most recently defined option. It can be chained right after `Define()` for ergonomics.

### Environment variables (LoadEnv)

Import env vars matching `<PREFIX>_<KEY>`. Names are lowercased and `_` becomes `.`:

```cpp
// With env: XTILS_LOG_LEVEL=2  XTILS_SERVER_PORT=9000
config.LoadEnv("XTILS");
config.Get<int64_t>("log.level");     // → 2
config.Get<int64_t>("server.port");   // → 9000
```

The return value is the number of vars actually imported. An empty `prefix` imports every env var (lowercased) — use sparingly.

### CLI Argument Format

```bash
# Flat keys
./app --server.port 9090 --server.ssl true

# With config file (file loaded first, CLI overrides)
./app --config-file prod.json --server.port 9090

# Array values
./app --allowed-origins '["http://localhost:3000","http://example.com"]'
```

## Access (Dot-Notation Paths)

```cpp
// Type-safe getters (return std::optional)
std::optional<std::string> GetString(const std::string& path) const;
std::optional<int64_t> GetInt(const std::string& path) const;
std::optional<double> GetDouble(const std::string& path) const;
std::optional<bool> GetBool(const std::string& path) const;
std::optional<Json> Get(const std::string& path) const;

// Generic template
template <typename T>
std::optional<T> Get(const std::string& path) const;

// Check existence
bool Has(const std::string& path) const;
```

Dot notation traverses nested JSON objects:

```cpp
// Given: {"server": {"tls": {"cert": "/path/to/cert.pem"}}}
auto cert = config.GetString("server.tls.cert");  // → "/path/to/cert.pem"
```

## Mutation

```cpp
void Set(const std::string& path, const Json& value);

template <typename T>
void Set(const std::string& path, const T& value);
```

## Validation & Help

```cpp
// Check all required options are present
bool Validate() const;

// Get list of missing required fields
std::vector<std::string> MissingRequired() const;

// Generate help text (all defined options with descriptions and defaults)
std::string Help() const;
```

## Serialization

```cpp
std::string ToString() const;           // Pretty-print current config
Json ToJson() const;                    // Export as Json object
bool Save(const std::string& filename) const;  // Write to file
void Print() const;                     // Print to stdout
```

## Hot reload (ConfigWatcher)

`ConfigWatcher` (`xtils/config/config_watcher.h`) uses inotify to watch a config file. When the file is rewritten the config is reloaded and the callback fires on the watcher's `TaskRunner` thread. RAII — stops on destruction.

```cpp
#include "xtils/config/config_watcher.h"

Config cfg;
cfg.LoadFile("/etc/app.json");

ConfigWatcher watcher(&cfg, &task_runner);
watcher.Watch("/etc/app.json", [](Config& cfg) {
  LogI("config reloaded; new log level: %lld",
       cfg.GetInt("log.level").value_or(0));
});

// `watcher` Stop()s automatically when it goes out of scope.
```

A second call to `Watch()` replaces the previous watch.

::: warning v2.0 breaking change
The legacy `config_compat.h` was removed in v2.0.0; all snake_case wrappers (`get`/`load_file`/`parse`/`define`, ...) are gone. Use the PascalCase API.
:::

## Integration with App Framework

When using the App framework, each service automatically receives its own config section. The section key matches the service name:

```json
{
  "api": {
    "port": 8080,
    "cors_origin": "*"
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "myapp"
  }
}
```

```cpp
class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  void Init() override {
    // `config` is pre-populated with the "api" section
    auto port = config.GetInt("port").value_or(8080);
    auto cors = config.GetString("cors_origin").value_or("*");
  }
};

class DatabaseService : public Service<DatabaseService> {
 public:
  DatabaseService() : Service("database") {}

  void Init() override {
    // `config` is pre-populated with the "database" section
    auto host = config.GetString("host").value_or("localhost");
    auto port = config.GetInt("port").value_or(5432);
  }
};
```

## Complete Example

```cpp
#include <xtils/config/config.h>
#include <xtils/logging/logger.h>

using namespace xtils;

int main(int argc, char** argv) {
  Config config;
  
  // Define all options with descriptions
  config.Define("server.host", "Server bind address", std::string("0.0.0.0"));
  config.Define("server.port", "Server port", int64_t(8080));
  config.Define<bool>("server.ssl", "Enable SSL/TLS", false);
  config.Define<std::string>("server.cert", "TLS certificate path", "");
  config.Define<std::string>("database.url", "Database connection URL", "", true);
  config.Define("workers", "Number of worker threads", int64_t(4));

  // Parse (file + CLI)
  config.ParseArgs(argc, const_cast<const char**>(argv));

  // Validate required fields
  if (!config.Validate()) {
    auto missing = config.MissingRequired();
    for (auto& m : missing) {
      LogE("Missing required config: %s", m.c_str());
    }
    LogI("\n%s", config.Help().c_str());
    return 1;
  }

  // Use config values
  auto host = config.GetString("server.host").value_or("0.0.0.0");
  auto port = config.GetInt("server.port").value_or(8080);
  LogI("Starting server on %s:%lld", host.c_str(), port);

  // Runtime mutation
  config.Set("server.started_at", Json(time(nullptr)));
  
  // Save current config state
  config.Save("runtime_config.json");
  
  return 0;
}
```
