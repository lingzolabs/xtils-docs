# Scripting

`xtils::Scripting` embeds the [QuickJS-NG](https://github.com/quickjs-ng/quickjs) JavaScript engine: an RAII-safe runtime, context management, native-function registration, and bidirectional `xtils::Json` conversion.

## Overview

Use cases:

- Dynamic rules, hot-reloadable business logic, user scripts
- Hand a C++ data structure (`Json`) to a JS expression and read it back
- Faster JSON parsing than `xtils::Json::parse` (QuickJS `JSON.parse` is ~2.5x faster)

::: warning Build flag
The scripting module is opt-in via `SCRIPTING_ENABLE=ON`:

```bash
cmake -B build -DSCRIPTING_ENABLE=ON
```

QuickJS-NG is fetched automatically via `FetchContent` (no submodule). All headers are guarded by `#ifdef XTILS_HAS_SCRIPTING`; the module compiles to nothing when disabled.
:::

## Headers

```cpp
#include "xtils/scripting/engine.h"        // ScriptEngine
#include "xtils/scripting/context.h"       // ScriptContext, NativeFunc
#include "xtils/scripting/value.h"         // ScriptValue
#include "xtils/scripting/binding.h"       // ToScriptValue / MakeUndefined / MakeNull
#include "xtils/scripting/json_interop.h"  // Json ↔ ScriptValue
```

Namespace: `xtils`.

## Engine and context

### ScriptEngine — runtime

A `ScriptEngine` owns one QuickJS `JSRuntime`, with memory and stack limits:

```cpp
class ScriptEngine {
 public:
  ScriptEngine();
  ~ScriptEngine();

  std::unique_ptr<ScriptContext> CreateContext();

  void SetMemoryLimit(size_t limit);
  void SetMaxStackSize(size_t stack_size);
  void RunGC();
};
```

Non-copyable, movable.

### ScriptContext — execution context

```cpp
class ScriptContext {
 public:
  ScriptValue Eval(const std::string& code,
                   const std::string& filename = "<eval>");
  ScriptValue EvalFile(const std::string& path);

  void RegisterFunction(const std::string& name, NativeFunc func);

  JSContext* Raw();  // raw QuickJS handle
};

using NativeFunc =
    std::function<ScriptValue(ScriptContext& ctx,
                              const std::vector<ScriptValue>& args)>;
```

::: tip
JS exceptions show up as a `ScriptValue` with `IsException() == true`. Always check.
:::

## ScriptValue — JS value

Move-only RAII wrapper, releases the QuickJS reference on destruction.

```cpp
class ScriptValue {
 public:
  bool IsString()    const;
  bool IsNumber()    const;
  bool IsBool()      const;
  bool IsNull()      const;
  bool IsUndefined() const;
  bool IsObject()    const;
  bool IsArray()     const;
  bool IsException() const;

  std::string ToString() const;
  int64_t     ToInt()    const;
  double      ToDouble() const;
  bool        ToBool()   const;

  JSValue     Raw() const;
  JSContext*  Ctx() const;
};
```

Construction helpers (`xtils/scripting/binding.h`):

```cpp
ScriptValue ToScriptValue(ScriptContext& ctx, int32_t v);
ScriptValue ToScriptValue(ScriptContext& ctx, int64_t v);
ScriptValue ToScriptValue(ScriptContext& ctx, double  v);
ScriptValue ToScriptValue(ScriptContext& ctx, bool    v);
ScriptValue ToScriptValue(ScriptContext& ctx, const std::string& v);
ScriptValue ToScriptValue(ScriptContext& ctx, const char* v);

ScriptValue MakeUndefined(ScriptContext& ctx);
ScriptValue MakeNull(ScriptContext& ctx);
```

## Native functions

```cpp
ScriptEngine engine;
auto ctx = engine.CreateContext();

ctx->RegisterFunction("add", [](ScriptContext& c,
                                const std::vector<ScriptValue>& args) {
  if (args.size() < 2) return MakeUndefined(c);
  return ToScriptValue(c, args[0].ToInt() + args[1].ToInt());
});

auto result = ctx->Eval("add(3, 4)");
LogI("3 + 4 = %lld", result.ToInt());  // 7
```

## Json interop

`xtils/scripting/json_interop.h` is the bridge between `Json` and `ScriptValue` and the most-used entry point of the module.

```cpp
// Json → JS (recurses through null/bool/integer/float/string/array/object).
ScriptValue JsonToScriptValue(ScriptContext& ctx, const Json& json);

// JS → Json (function and other exotic types become null).
Json ScriptValueToJson(const ScriptValue& value);

// Inject Json as a global variable, then evaluate.
ScriptValue EvalWithJson(ScriptContext& ctx,
                         const std::string& var_name,
                         const Json& json,
                         const std::string& code,
                         const std::string& filename = "<eval>");

// Eval and pull the result back as Json.
Json EvalToJson(ScriptContext& ctx,
                const std::string& code,
                const std::string& filename = "<eval>");

// Use QuickJS' JSON.parse / JSON.stringify.
Json        JsonParseViaJs    (ScriptContext& ctx, const std::string& json_str);
std::string JsonStringifyViaJs(ScriptContext& ctx, const Json& json,
                               int indent = 0);
```

### Example: filter data via a JS expression

```cpp
#include "xtils/scripting/engine.h"
#include "xtils/scripting/json_interop.h"

ScriptEngine engine;
auto ctx = engine.CreateContext();

Json users = Json::parse(R"([
  {"name":"alice","age":30},
  {"name":"bob","age":17},
  {"name":"carol","age":25}
])").value();

auto result = EvalWithJson(*ctx, "users", users, R"(
  users.filter(u => u.age >= 18).map(u => u.name)
)");

Json names = ScriptValueToJson(result);
LogI("adults: %s", names.dump().c_str());
// ["alice","carol"]
```

### Example: fast JSON parsing

```cpp
ScriptEngine engine;
auto ctx = engine.CreateContext();

std::string big = LoadHugeJsonFile();

// ~2.5x faster than Json::parse(big).
Json parsed = JsonParseViaJs(*ctx, big);
```

## Full example: scripted business rules

```cpp
#include <xtils/app/service.h>
#include <xtils/scripting/engine.h>
#include <xtils/scripting/json_interop.h>
#include <xtils/utils/file_utils.h>

using namespace xtils;

class RuleService : public Service<RuleService> {
 public:
  RuleService() : Service("rules") {}

  void Init() override {
    engine_.SetMemoryLimit(8 * 1024 * 1024);
    ctx_ = engine_.CreateContext();

    ctx_->RegisterFunction("now_ms",
        [](ScriptContext& c, const std::vector<ScriptValue>&) {
          return ToScriptValue(c, static_cast<int64_t>(
              std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::system_clock::now().time_since_epoch()).count()));
        });

    std::string script;
    file_utils::read(config.GetOr<std::string>("rule_file", "rules.js"), script);
    ctx_->Eval(script, "rules.js");
  }

  Json Apply(const Json& event) {
    return EvalWithJson(*ctx_, "evt", event,
                        "applyRule(evt)", "rule_call");
  }

  void Deinit() override { ctx_.reset(); }

 private:
  ScriptEngine engine_;
  std::unique_ptr<ScriptContext> ctx_;
};
```

## Caveats

- **Single-threaded**: each `ScriptContext` is bound to one thread. Use one context per worker thread for concurrency.
- **Errors**: detect via `ScriptValue::IsException()`; or `try/catch` inside JS and return a structured error.
- **GC**: long-running processes can periodically call `engine.RunGC()` or rely on QuickJS' incremental collector.
- **Class binding**: `xtils/scripting/class_binding.h` ships helpers for exporting C++ classes to JS — not covered here; see source plus `examples/scripting_*.cc`.
