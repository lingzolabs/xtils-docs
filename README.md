# xtils-docs

[xtils](https://github.com/lingzolabs/xtils) C++17 静态工具库的文档站点，基于 [VitePress](https://vitepress.dev/) 构建。

**在线访问：** https://lingzolabs.github.io/xtils-docs/

## 特性

- 📖 中英文双语 (默认中文)
- 📐 Excalidraw 架构图
- 🚀 GitHub Actions 自动部署到 GitHub Pages

## 本地开发

```bash
npm install
make dev       # 启动开发服务器 http://localhost:5173
make build     # 构建静态站点
make preview   # 预览构建结果
```

## 目录结构

```
.
├── guide/           # 指南 (中文)
├── modules/         # 模块文档 (中文)
├── examples/        # 示例 (中文)
├── en/              # English translations
├── public/images/   # Excalidraw 图表 (.svg + .excalidraw)
├── .vitepress/      # VitePress 配置
└── .github/         # CI/CD 部署工作流
```

## 许可证

MIT
