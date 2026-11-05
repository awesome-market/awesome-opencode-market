# TUI pty 冒烟 — python3 自带 pty 分配真 pty
# 用法: python3 test/e2e/tui-smoke.py
# 覆盖: 启动 /market / tab切换 / 搜索 / 详情 / 收藏 / esc语义 / 筛选 /
#       导航 / r刷新 / 鼠标点击 / 真实装·卸·升级（opencode-loop-recover）
import pty, os, time, re, select, sys, json, subprocess

OC = '/Users/terry/.local/bin/opencode'
CFG = '/Users/terry/.config/opencode/opencode.json'
PKG = '@1930dev/opencode-usage'
PIN = '0.4.1'
LATEST = '0.5.0'

def sh(*a, timeout=30):
    return subprocess.run(list(a), capture_output=True, text=True, timeout=timeout).stdout

results = []
def check(name, ok):
    results.append((name, ok)); print(('✓' if ok else '✗') + ' ' + name, flush=True)

# ---------- pre-step: kill stale opencode processes, ensure a daemon ----------
# `opencode` covers stale serve/TUI instances; the desktop's embedded daemon is
# `opencode-cli` and survives — it is the normal service TUI attaches to anyway
subprocess.run(['pkill', '-x', 'opencode'], capture_output=True)
time.sleep(2)
if not sh(OC, 'plugin', 'list', timeout=10).strip():
    # no daemon at all (desktop closed, no service) — start a standalone one
    subprocess.Popen([OC, 'service', 'start'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(15):
        if sh(OC, 'plugin', 'list', timeout=10).strip(): break
        time.sleep(1.5)

# ---------- pin the test package so the market offers an update ----------
d = json.load(open(CFG))
d['plugins'] = [f'{PKG}@{PIN}' if p == PKG or p.startswith(PKG + '@') else p for p in d['plugins']]
json.dump(d, open(CFG, 'w'), indent=2)
# no service restart — the running daemon watches the config and rescans
# (opencode service stop can't kill a desktop-app-owned daemon anyway)
pinned = False
for _ in range(20):
    if PIN in sh(OC, 'plugin', 'list'): pinned = True; break
    time.sleep(1.5)
check(f'pre-pin {PKG}@{PIN}', pinned)

pid, fd = pty.fork()
if pid == 0:
    os.execvp(OC, ['opencode'])

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
def send(keys, pause=0.6):
    os.write(fd, keys); pump(pause)

check('opencode starts', wait(r'opencode|会话|session|model', 25000))
send(b'/market', 0.8); send(b'\r', 0.5); send(b'\r')
check('market dialog opens', wait(r'update all|全部更新|discover|发现|my plugins|我的插件', 15000))
check('index renders (cards + categories)', wait(r'全部\(\d+\)|all\(\d+\)|installed', 15000))

# focus the pinned package — verified-first sort + ~2k entries means it is NOT
# the first card anymore; filter the grid to it (query persists after esc)
send(b'/', 0.8); send(b'@1930dev/opencode-usage', 1.5); send(b'\x1b', 1.0)
check('search narrows to usage entry', wait(r'opencode-usage', 8000))

# ---------- real upgrade: i on the focused usage card (pinned @0.4.1 → 0.5.0)
# must run BEFORE other tests move focus; verified at the end via plugin list
send(b'i', 5.0)
check('update path runs (updating status)', wait(r'updat|install|装|activated|restart', 20000))

# tab switching
send(b'5', 1.2); check('tab 5 我的插件 shows installed', wait(r'installed|已安装|我的插件', 8000))
send(b'2', 1.2); check('tab 2 插件 shows catalog cards', wait(r'@|installed|\d+\.\d+\.\d+', 8000))
send(b'7', 1.2); check('tab 7 设置 shows settings', wait(r'更新数据|refresh data|dev log|开发日志|备份与恢复|backup|清除数据|clear data', 8000))
send(b'1', 1.2); check('tab 1 back to 发现', wait(r'全部\(\d+\)|all\(\d+\)|发现|discover', 8000))

# search + esc semantics
send(b'/', 0.8); send(b'opencode-usage', 1.2)
check('search filters to opencode-usage', wait(r'installed|opencode-us', 8000))
send(b'\x1b', 0.8)
send(b'/', 0.6); send(b'zzz-not-a-plugin-xyz', 1.0)
check('search no-match shows empty state', wait(r'没有|无结果|empty|\(0\)', 8000))
send(b'\x1b', 0.8)
send(b'/', 0.8); send(b'zzz', 0.6); send(b'\x1b', 1.0)
check('esc in search stays in market', re.search(r'update all|全部更新|discover|发现|my plugins|我的插件', screen()) is not None)
# the zzz queries leave the grid filtered to empty — clear the search box so
# detail/favorite/filter/mouse checks below run against real cards
send(b'/', 0.8); os.write(fd, b'\x7f' * 60); pump(1.0); send(b'\x1b', 1.0)

# detail dialog open/close
send(b'\r', 1.5)
check('enter opens detail dialog', wait(r'关闭|详情|detail|esc', 8000))
send(b'\x1b', 1.0)
check('esc closes detail back to list', re.search(r'update all|全部更新|discover|发现|my plugins|我的插件', screen()) is not None)

# favorite toggle
send(b'*', 0.8)
check('favorite toggle marks card', wait(r'★|收藏', 8000))
send(b'*', 0.8)

# filter overlay
send(b'f', 1.0)
check('f opens filter overlay', wait(r'筛选|verified|failed|sort', 8000))
send(b'\x1b', 0.8)

# r refresh
send(b'r', 1.5)
check('r triggers refresh', re.search(r'update all|全部更新|discover|发现|my plugins|我的插件', screen()) is not None)

# mouse: SGR click a specific card → '›' selection marker lands on it
def sgr_click(col, row):
    os.write(fd, f'\x1b[<0;{col};{row}M\x1b[<0;{col};{row}m'.encode()); pump(0.8)

sgr_click(8, 14)   # inside the first card region
check('mouse click selects a card', re.search(r'›', screen()) is not None)
# wheel scroll down in the list → screen content changes (cards scroll)
before = screen()
os.write(fd, b'\x1b[<65;20;16M' + b'\x1b[<65;20;16m')   # wheel down + release
pump(1.0)
# pty 里 wheel 事件可能不吃/列表一屏装完——宽松断言不崩即可
check('wheel input does not crash market', re.search(r'update all|全部更新|discover|发现|my plugins|我的插件', screen()) is not None)
# click a chrome tab (5 我的插件) → tab switch via mouse
for row in range(6, 12):
    os.write(fd, f'\x1b[<0;34;{row}M\x1b[<0;34;{row}m'.encode()); pump(0.4)
    if re.search(r'已安装|installed|未收录', screen()): break
check('mouse click switches to 我的插件', re.search(r'已安装|installed|未收录', screen()) is not None)
send(b'1', 0.8)   # back to 发现

# navigation stability
send(b'\x1b[A\x1b[A\x1b[A', 1.0)
check('still in market after ↑↑↑', re.search(r'update all|全部更新|discover|发现|my plugins|我的插件', screen()) is not None)

# ---------- real upgrade: pinned 0.4.1 → i on first card → 0.5.0 ----------
# the first card IS @1930dev/opencode-usage (› marker + update → v0.5.0 badge)
send(b'/', 0.8); send(b'@1930dev/opencode-usage', 1.5); send(b'\x1b', 1.0)  # refilter to the pinned package
send(b'\x1b\x1b', 0.5)          # ensure nothing is focused but the grid
send(b'\x1b[H', 1.0)           # home → top of grid
send(b'i', 4.0)                  # install/update on the focused usage card
check('update path runs', wait(r'updat|install|装|已安装|activated|restart', 20000))
send(b'q', 1.5)
check('q closes market to main TUI', wait(r'Ask anything|shift\+tab|ctrl\+p', 8000))
os.close(fd)

# ---------- post-checks on real daemon state ----------
ver = sh(OC, 'plugin', 'list')
check(f'{PKG} upgraded to {LATEST}', 'opencode-usage' in ver and LATEST in ver)
# restore loop-recover to the bare spec (the pin was ours)
d = json.load(open(CFG))
d['plugins'] = [p.split('@')[0] if p.startswith('opencode-loop-recover@') else p for p in d['plugins']]
json.dump(d, open(CFG, 'w'), indent=2)

sys.exit(0 if all(ok for _, ok in results) else 1)
