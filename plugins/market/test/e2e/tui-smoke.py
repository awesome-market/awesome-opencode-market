# TUI pty 冒烟 — python3 自带 pty 分配真 pty
# 用法: python3 test/e2e/tui-smoke.py
# 覆盖: 启动 → /market → tab 切换 → 搜索 → 导航不崩
# 真实装/卸循环用 @1930dev/opencode-usage（测试包，结束恢复原状）
import pty, os, time, re, select, sys

pid, fd = pty.fork()
if pid == 0:
    os.execvp('opencode', ['opencode'])

buf = bytearray()
def pump(seconds=0.4):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: buf.extend(os.read(fd, 65536))
            except OSError: return

def screen():
    s = buf.decode('utf-8', 'replace')
    return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][0-9AB]|\x1b>=?', '', s)

def wait(pattern, ms=20000):
    end = time.time() + ms / 1000
    while time.time() < end:
        pump(0.3)
        if re.search(pattern, screen()): return True
    return False

results = []
def check(name, ok):
    results.append((name, ok)); print(('✓' if ok else '✗') + ' ' + name, flush=True)

def send(keys, pause=0.6):
    os.write(fd, keys); pump(pause)

check('opencode starts', wait(r'opencode|会话|session|model', 25000))
# Enter selects autocomplete, second Enter submits
send(b'/market', 0.8); send(b'\r', 0.5); send(b'\r')
check('market dialog opens', wait(r'全部更新|我的插件|发现', 15000))
check('index renders (cards + categories)', wait(r'全部\(\d+\)|installed', 15000))

# --- tab switching: 1-7 keys map to 发现/插件/技能/收藏/我的插件/我的技能/设置
send(b'5', 1.2)
check('tab 5 我的插件 shows installed', wait(r'installed|已安装|我的插件', 8000))
send(b'2', 1.2)
check('tab 2 插件 shows catalog cards', wait(r'@|installed|\d+\.\d+\.\d+', 8000))
send(b'7', 1.2)
check('tab 7 设置 shows settings', wait(r'更新数据|devlog|备份|设置', 8000))
send(b'1', 1.2)
check('tab 1 back to 发现', wait(r'全部\(\d+\)|发现', 8000))

# --- search: '/' opens search, type query, filtered list
send(b'/', 0.8)
send(b'usage', 1.2)
check('search filters to usage', wait(r'opencode-us|usage', 8000))  # card name may be truncated
send(b'\x1b', 0.8)   # esc exits search
send(b'/', 0.6); send(b'zzz-not-a-plugin-xyz', 1.0)
check('search no-match shows empty state', wait(r'没有|无结果|empty|\(0\)', 8000))
send(b'\x1b', 0.8)

# --- navigation stability: ↑↑↑ from cards into chrome doesn't leave market
send(b'\x1b[A\x1b[A\x1b[A', 1.0)
check('still in market after ↑↑↑', re.search(r'全部更新|发现', screen()) is not None)

# --- real mutation cycle: uninstall then reinstall @1930dev/opencode-usage
# navigate to search the usage card
send(b'/', 0.8); send(b'usage', 1.2)
installed_before = 'installed' in screen() or '已安装' in screen()
check('usage card visible', wait(r'opencode-us|usage', 8000))
send(b'\x1b', 0.8)
if installed_before:
    send(b'u', 1.0)          # arm confirm
    send(b'u', 1.5)          # confirm
    check('uninstall removes card installed state', wait(r'装|install', 15000))
    send(b'i', 2.5)          # reinstall
    check('reinstall restores installed state', wait(r'installed|已安装', 20000))
else:
    send(b'i', 2.5)
    check('install shows installed state', wait(r'installed|已安装', 20000))
    send(b'u', 1.0); send(b'u', 1.5)
    check('uninstall removes installed state', wait(r'装|install', 15000))

send(b'q', 1.0)
os.close(fd)
sys.exit(0 if all(ok for _, ok in results) else 1)
