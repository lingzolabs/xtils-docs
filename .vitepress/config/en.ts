import { DefaultTheme, LocaleSpecificConfig } from 'vitepress'

export const en: LocaleSpecificConfig<DefaultTheme.Config> = {
  lang: 'en-US',
  description: 'C++17 Static Utility Library — App framework, networking, FSM, behavior trees, async tasks, and more.',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/en/guide/introduction', activeMatch: '/en/guide/' },
      { text: 'Modules', link: '/en/modules/app', activeMatch: '/en/modules/' },
      { text: 'Examples', link: '/en/examples/robot-vacuum', activeMatch: '/en/examples/' },
      { text: 'Changelog', link: '/en/changelog' }
    ],
    sidebar: {
      '/en/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/en/guide/introduction' },
            { text: 'Quick Start', link: '/en/guide/getting-started' },
            { text: 'Architecture', link: '/en/guide/architecture' }
          ]
        }
      ],
      '/en/modules/': [
        {
          text: 'Core',
          items: [
            { text: 'App Framework', link: '/en/modules/app' },
            { text: 'Config', link: '/en/modules/config' },
            { text: 'Logging', link: '/en/modules/logging' }
          ]
        },
        {
          text: 'State Machines',
          items: [
            { text: 'FSM', link: '/en/modules/fsm' },
            { text: 'Behavior Tree', link: '/en/modules/behavior-tree' }
          ]
        },
        {
          text: 'I/O & Concurrency',
          items: [
            { text: 'Networking', link: '/en/modules/networking' },
            { text: 'Tasks & Scheduling', link: '/en/modules/tasks' }
          ]
        },
        {
          text: 'Utilities',
          items: [
            { text: 'System', link: '/en/modules/system' },
            { text: 'Utils', link: '/en/modules/utils' },
            { text: 'Debug', link: '/en/modules/debug' }
          ]
        }
      ],
      '/en/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Robot Vacuum Simulator', link: '/en/examples/robot-vacuum' },
            { text: 'BT Editor & Debugger', link: '/en/examples/bt-editor' }
          ]
        }
      ]
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Albert Lv'
    }
  }
}
