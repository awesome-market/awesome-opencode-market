# TUI pty 冒烟 — python3 自带 pty 分配真 pty（node-pty 本机坏 / script 要真 stdin）
# 用法: python3 test/e2e/tui-smoke.py
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
    results.append(ok); print(('✓' if ok else '✗') + ' ' + name, flush=True)

check('opencode starts', wait(r'opencode|market|会话|session|model', 25000))
# Enter selects the autocomplete suggestion; a second Enter submits the command
os.write(fd, b'/market')
time.sleep(0.8)
os.write(fd, b'\r'); time.sleep(0.5); os.write(fd, b'\r')
check('market dialog opens', wait(r'全部更新|我的插件|发现', 15000))
check('index renders (cards + categories)', wait(r'全部\(\d+\)|installed', 15000))
# ↑↑↑ from cards into chrome must not crash/leave the market
os.write(fd, b'\x1b[A\x1b[A\x1b[A')
time.sleep(1)
check('still in market after ↑↑↑', re.search(r'全部更新|发现', screen()) is not None)
os.write(fd, b'q')
time.sleep(1)
os.close(fd)
sys.exit(0 if all(results) else 1)
