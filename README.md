# agent-healthcheck

AI Agent 运行环境体检。不查代码（那是 linter 的事），查的是**跑起来会不会坏**。

## 查什么

- **系统代理**（Windows）：代理开着但端口没人监听 → 所有出站打到死端口，表现为"模型挂了"
- **备份可恢复**：备份目录在不在、最新一份多久、文件头是不是合法 zip
- **明文凭证**：npm token、git 凭证是否以明文躺在配置里（正常，但别提交进仓库）
- **运行时**：Node 版本是否够、时钟是否正常

## 用法

```bash
npx agent-healthcheck
npx agent-healthcheck --json
npx agent-healthcheck --backup D:\my-backups
```

输出每条带结论、证据、修复建议。退出码：0 无致命项，1 有。

## 它不查什么

- 不查代码质量（用 linter / 专门的 code-health 工具）
- 不探活远端服务（网络类误报太多）
- 只覆盖 Windows 注册表代理；macOS/Linux 跳过该项

## 为什么做这个

自己搭的常驻 Agent，"莫名挂了、重启又好"是常态。大部分不是玄学，是四类地方埋了雷：代理、备份、凭证、运行时。

体检就是把"莫名"变成"查得出"。

## License

MIT

---

本项目由作者与 AI 助手协作完成：作者定方向、做取舍、验证结论；AI 负责整理素材与起草。功能与结论均可在本地复现。

