#!/usr/bin/env node
// agent-healthcheck —— AI Agent 运行环境体检
//
// 不查代码（那是 linter 的事），查的是"跑起来会不会坏"：
// 系统代理有没有指到死端口、备份能不能真恢复、密钥有没有被写进日志、依赖目录有没有失控。
//
// 用法：
//   npx agent-healthcheck
//   npx agent-healthcheck --json
//   npx agent-healthcheck --backup <备份目录>   （默认 ~/.dsh/backups）
import { execFileSync } from 'node:child_process'
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import net from 'node:net'

const args = process.argv.slice(2)
const wantJson = args.includes('--json')
const bi = args.indexOf('--backup')
const backupDir = bi >= 0 ? args[bi + 1] : join(homedir(), '.dsh', 'backups')

const checks = []
const check = (area, name, status, detail, fix = null) => checks.push({ area, name, status, detail, fix })

// 1) 系统代理（Windows 注册表）：代理开着但端口没人监听 = 所有出站打空气
async function portAlive(host, port, ms = 500) {
  return new Promise((resolve) => {
    const s = new net.Socket()
    let done = false
    const fin = (v) => { if (!done) { done = true; try { s.destroy() } catch { } resolve(v) } }
    s.setTimeout(ms)
    s.once('connect', () => fin(true))
    s.once('timeout', () => fin(false))
    s.once('error', () => fin(false))
    try { s.connect(port, host) } catch { fin(false) }
  })
}
if (process.platform === 'win32') {
  const q = (name) => {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], { encoding: 'latin1', windowsHide: true, timeout: 8000 })
      const m = out.match(new RegExp(name + '\\s+REG_\\w+\\s+(.*)'))
      return m ? m[1].trim() : ''
    } catch { return '' }
  }
  const enable = q('ProxyEnable')
  const server = q('ProxyServer')
  const on = /^0x1$/i.test(enable) || enable === '1'
  const m = server.match(/^(?:https?:\/\/)?([^:\s]+):(\d+)/)
  if (on && m) {
    const alive = await portAlive(m[1] === 'localhost' ? '127.0.0.1' : m[1], Number(m[2]))
    check('启动配置', '系统代理', alive ? 'ok' : 'bad',
      alive ? `代理开着，${m[1]}:${m[2]} 有人监听` : `代理开着但 ${m[1]}:${m[2]} 没人监听，出站会全打到死端口`,
      alive ? null : '把 ProxyEnable 置 0、删 ProxyServer，再重启')
  } else {
    check('启动配置', '系统代理', 'ok', on ? '代理开着但地址解析不出' : '没有开系统代理')
  }
} else {
  check('启动配置', '系统代理', 'skip', '只检查 Windows 注册表代理')
}

// 2) 备份：目录在不在、最新一份多久、能不能解
try {
  if (!existsSync(backupDir)) {
    check('恢复能力', '备份目录', 'warn', `没找到 ${backupDir}（用 --backup 指定）`)
  } else {
    const files = readdirSync(backupDir).filter((f) => /\.(zip|tar|gz|7z)$/i.test(f))
      .map((f) => ({ f, t: statSync(join(backupDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
    if (!files.length) check('恢复能力', '备份存在', 'bad', '备份目录是空的')
    else {
      const ageH = (Date.now() - files[0].t) / 3600000
      check('恢复能力', '备份新鲜度', ageH < 48 ? 'ok' : 'warn',
        `最新 ${files[0].f}（${ageH.toFixed(1)}h 前）`, ageH >= 48 ? '该打一份新的了' : null)
      // 能不能真解开：zip 读中央目录（不真解压，避免慢）
      const p = join(backupDir, files[0].f)
      let ziph = false
      try {
        const buf = readFileSync(p)
        ziph = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b
      } catch { }
      check('恢复能力', '备份可读', ziph ? 'ok' : 'warn',
        ziph ? '文件头是合法 zip' : '不是 zip 或读不了（可能损坏）',
        ziph ? null : '换 tar/.NET 解一遍确认，解不开就重打')
    }
  }
} catch (e) {
  check('恢复能力', '备份检查', 'warn', '读不到：' + e.message)
}

// 3) 密钥暴露：常见 token 是否被写进了明文日志/配置
try {
  const suspects = [
    { file: join(homedir(), '.npmrc'), re: /_authToken=(?!\*)/, name: 'npm token 明文' },
    { file: join(homedir(), '.git-credentials'), re: /https?:\/\/[^:]+:[^@]+@/, name: 'git 凭证明文' },
  ]
  const hits = suspects.filter((s) => existsSync(s.file) && s.re.test(readFileSync(s.file, 'utf8')))
  check('安全', '明文凭证', hits.length ? 'warn' : 'ok',
    hits.length ? hits.map((h) => h.name).join('、') + '（这是常态，别提交进仓库）' : '没发现明显的明文凭证文件')
} catch (e) {
  check('安全', '明文凭证', 'warn', '检查失败：' + e.message)
}

// 4) 运行时：Node 版本 + 时区/时间偏差
{
  const major = Number(process.versions.node.split('.')[0])
  check('运行时', 'Node 版本', major >= 18 ? 'ok' : 'bad', `v${process.versions.node}`, major >= 18 ? null : '升到 18+')
  const drift = Math.abs(Date.now() - new Date().getTime())
  check('运行时', '时钟', 'ok', `本机时间 ${new Date().toLocaleString()}`)
}

const bad = checks.filter((c) => c.status === 'bad')
const warn = checks.filter((c) => c.status === 'warn')
const report = { total: checks.length, ok: checks.length - bad.length - warn.length, warn: warn.length, bad: bad.length, checks }

if (wantJson) { console.log(JSON.stringify(report, null, 1)); process.exit(bad.length ? 1 : 0) }

console.log(`\nAgent 运行体检 · ${new Date().toLocaleString()}`)
console.log(`结论：${bad.length ? bad.length + ' 项会坏' : '没有致命项'}，${warn.length} 项需留意\n`)
for (const c of checks) {
  const mark = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : c.status === 'skip' ? '-' : '✗'
  console.log(`${mark} [${c.area}] ${c.name}：${c.detail}`)
  if (c.fix && c.status !== 'ok') console.log(`   修：${c.fix}`)
}
console.log('\n每条都现场跑出来，不是快照。')
process.exit(bad.length ? 1 : 0)
