import { DefaultTheme, LocaleSpecificConfig } from 'vitepress'

export const zh: LocaleSpecificConfig<DefaultTheme.Config> = {
  lang: 'zh-CN',
  description: 'C++17 静态工具库 — 应用框架、网络、状态机、行为树、异步任务等',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '模块', link: '/modules/app', activeMatch: '/modules/' },
      { text: '示例', link: '/examples/robot-vacuum', activeMatch: '/examples/' },
      { text: '更新日志', link: '/changelog' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '简介', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '架构设计', link: '/guide/architecture' }
          ]
        }
      ],
      '/modules/': [
        {
          text: '核心模块',
          items: [
            { text: '应用框架', link: '/modules/app' },
            { text: '配置管理', link: '/modules/config' },
            { text: '日志系统', link: '/modules/logging' }
          ]
        },
        {
          text: '状态机',
          items: [
            { text: '有限状态机', link: '/modules/fsm' },
            { text: '行为树', link: '/modules/behavior-tree' }
          ]
        },
        {
          text: 'I/O 与并发',
          items: [
            { text: '网络', link: '/modules/networking' },
            { text: '任务调度', link: '/modules/tasks' }
          ]
        },
        {
          text: '工具库',
          items: [
            { text: '系统', link: '/modules/system' },
            { text: '通用工具', link: '/modules/utils' },
            { text: '调试工具', link: '/modules/debug' }
          ]
        }
      ],
      '/examples/': [
        {
          text: '示例',
          items: [
            { text: '扫地机器人模拟器', link: '/examples/robot-vacuum' },
            { text: 'BT 编辑器与调试器', link: '/examples/bt-editor' }
          ]
        }
      ]
    },
    footer: {
      message: '基于 MIT 许可证发布',
      copyright: 'Copyright © 2024-present Albert Lv'
    },
    docFooter: { prev: '上一页', next: '下一页' },
    outline: { label: '页面导航' },
    lastUpdated: { text: '最后更新于' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  }
}
