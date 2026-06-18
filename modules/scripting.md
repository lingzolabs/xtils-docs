# 脚本（Scripting）

`xtils::Scripting` 嵌入 [QuickJS-NG](https://github.com/quickjs-ng/quickjs) JavaScript 引擎，提供 RAII 安全的运行时、上下文管理、原生函数注册以及与 `xtils::Json` 的双向互转。

## 概述

适用场景：

- 动态规则、热更新业务逻辑、用户脚本
- 把 C++ 数据结构（`Json`）丢给 JS 表达式做计算后取回
- 比 C++ 实现更快的 JSON 解析（QuickJS 的 `JSON.parse` 比 `xtils::Json::parse` 快 ~2.5x）

::: warning 编译开关
脚本模块在编译时通过 `SCRIPTING_ENABLE=ON` 启用：

```bash
cmake -B build -DSCRIPTING_ENABLE=ON
```

启用后，QuickJS-NG 会通过 `FetchContent` 自动获取（无需手动添加 submodule）。所有相关头文件以 `#ifdef XTILS_HAS_SCRIPTING` 守护，未启用时整体不参与编译。
:::

## 头文件

```cpp
#include "xtils/scripting/engine.h"        // ScriptEngine
#include "xtils/scripting/context.h"       // ScriptContext, NativeFunc
#include "xtils/scripting/value.h"         // ScriptValue
#include "xtils/scripting/binding.h"       // ToScriptValue / MakeUndefined / MakeNull
#include "xtils/scripting/json_interop.h"  // Json ↔ ScriptValue
```

命名空间：`xtils`。

## 引擎与上下文

### ScriptEngine — 运行时

一个 `ScriptEngine` 拥有一个 QuickJS `JSRuntime`，提供内存与栈限制：

```cpp
class ScriptEngine {
 public:
  ScriptEngine();
  ~ScriptEngine();

  // 创建一个新上下文（拥有所有权）
  std::unique_ptr<ScriptContext> CreateContext();

  void SetMemoryLimit(size_t limit);
  void SetMaxStackSize(size_t stack_size);
  void RunGC();
};
```

不可拷贝，可移动。

### ScriptContext — 执行上下文

`ScriptContext` 由 `ScriptEngine::CreateContext()` 创建，承载实际的 JS 代码执行。

```cpp
class ScriptContext {
 public:
  ScriptValue Eval(const std::string& code,
                   const std::string& filename = "<eval>");
  ScriptValue EvalFile(const std::string& path);

  void RegisterFunction(const std::string& name, NativeFunc func);

  JSContext* Raw();  // 暴露原始 QuickJS 句柄
};

using NativeFunc =
    std::function<ScriptValue(ScriptContext& ctx,
                              const std::vector<ScriptValue>& args)>;
```

::: tip
JS 抛出异常时 `Eval` 返回 `IsException() == true` 的 `ScriptValue`，调用者应当检查。
:::

## ScriptValue — JS 值

仅可移动的 RAII 包装，析构时自动释放 QuickJS 引用。

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

构造便捷方法（`xtils/scripting/binding.h`）：

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

## 注册原生函数

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

## Json 互转

`xtils/scripting/json_interop.h` 提供 `Json` 与 `ScriptValue` 之间的桥接，是脚本模块最常用的入口。

```cpp
// Json → JS（递归转换 null/bool/integer/float/string/array/object）
ScriptValue JsonToScriptValue(ScriptContext& ctx, const Json& json);

// JS → Json（function 等无法序列化的类型转为 null）
Json ScriptValueToJson(const ScriptValue& value);

// 把 Json 注入为全局变量后求值
ScriptValue EvalWithJson(ScriptContext& ctx,
                         const std::string& var_name,
                         const Json& json,
                         const std::string& code,
                         const std::string& filename = "<eval>");

// 求值并把结果按 Json 取回
Json EvalToJson(ScriptContext& ctx,
                const std::string& code,
                const std::string& filename = "<eval>");

// 借助 QuickJS 的 JSON.parse / JSON.stringify
Json        JsonParseViaJs    (ScriptContext& ctx, const std::string& json_str);
std::string JsonStringifyViaJs(ScriptContext& ctx, const Json& json,
                               int indent = 0);
```

### 示例：用 JS 表达式过滤数据

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

// 注入 users 并执行 JS
auto result = EvalWithJson(*ctx, "users", users, R"(
  users.filter(u => u.age >= 18).map(u => u.name)
)");

Json names = ScriptValueToJson(result);
LogI("成年用户: %s", names.dump().c_str());
// ["alice","carol"]
```

### 示例：高速 JSON 解析

```cpp
ScriptEngine engine;
auto ctx = engine.CreateContext();

std::string big_json = LoadHugeJsonFile();

// 比 Json::parse(big_json) 快约 2.5x
Json parsed = JsonParseViaJs(*ctx, big_json);
```

## 完整示例：脚本化业务规则

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
    engine_.SetMemoryLimit(8 * 1024 * 1024);  // 8 MB 上限
    ctx_ = engine_.CreateContext();

    // 注册一些 helper
    ctx_->RegisterFunction("now_ms",
        [](ScriptContext& c, const std::vector<ScriptValue>&) {
          return ToScriptValue(c, static_cast<int64_t>(
              std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::system_clock::now().time_since_epoch()).count()));
        });

    std::string script;
    file_utils::read(config.GetOr<std::string>("rule_file", "rules.js"), script);
    ctx_->Eval(script, "rules.js");  // 加载用户规则
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

## 限制与注意事项

- **单线程**：每个 `ScriptContext` 只能从一个线程使用。需要并发时为每个工作线程持有独立 context。
- **错误处理**：JS 异常通过 `ScriptValue::IsException()` 判定；可在 JS 内显式 `try/catch` 后返回结构化错误。
- **GC**：长时间运行可周期性调用 `engine.RunGC()`，或依赖 QuickJS 自身的增量回收。
- **类绑定**：`xtils/scripting/class_binding.h` 提供 C++ 类导出到 JS 的辅助（更高级用法，当前文档未覆盖；参考源码与 `examples/scripting_*.cc`）。
