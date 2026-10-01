#!/usr/bin/env python3
"""Run DOM and extension-state regressions in headless Chromium without npm dependencies."""
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time

from browser import Browser

ROOT = Path(__file__).resolve().parents[1]


def main():
    browser = shutil.which('chromium') or shutil.which('google-chrome')
    if not browser:
        raise SystemExit('Chromium or Google Chrome is required.')
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    for script in [manifest['background']['service_worker'], *manifest['content_scripts'][0]['js'], 'options.js']:
        assert (ROOT / script).is_file(), script
    sources = {name: (ROOT / name).read_text() for name in ['background.js', 'content.js', 'options.js']}
    setup = (ROOT / 'tests/setup.js').read_text()
    tests = (ROOT / 'tests/regressions.js').read_text()
    page = '<!doctype html><html><head><style>' + (ROOT / 'style.css').read_text() + '</style></head><body><script>'
    page += 'const sources = ' + json.dumps(sources) + ';\n'
    page += setup + '\n' + sources['content.js'] + '\n' + tests + '</script></body></html>'
    with tempfile.TemporaryDirectory(prefix='freeform-tests-') as directory:
        directory = Path(directory)
        path = directory / 'regressions.html'
        path.write_text(page)
        result = subprocess.run([
            browser, '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
            '--no-first-run', '--disable-background-networking', '--no-proxy-server',
            f'--user-data-dir={directory / "profile"}', '--virtual-time-budget=3000',
            '--dump-dom', path.as_uri()
        ], capture_output=True, text=True, timeout=60)
        match = re.search(r'<pre id="test-results">(.*?)</pre>', result.stdout, re.S)
        if not match:
            print(result.stderr[-3000:])
            raise SystemExit('Browser tests did not finish.\n' + result.stdout[-3000:])
        results = json.loads(html.unescape(match.group(1)))
        for test in results:
            print(('PASS ' if test['passed'] else 'FAIL ') + test['name'])
            if not test['passed']:
                print(test['error'])
            if 'detail' in test:
                print('     ' + str(test['detail']))
        passed = sum(test['passed'] for test in results)
        print(f'{passed}/{len(results)} checks passed')
        if passed != len(results):
            raise SystemExit(1)
        run_extension_checks(browser, directory, manifest)


def run_extension_checks(browser, directory, manifest):
    extension = directory / 'extension'
    extension.mkdir()
    for name in ['background.js', 'content.js', 'style.css', 'options.js', 'options.html']:
        shutil.copyfile(ROOT / name, extension / name)
    shutil.copytree(ROOT / 'icons', extension / 'icons')
    manifest = json.loads(json.dumps(manifest))
    manifest['permissions'].append('clipboardRead')  # Test-only permission to verify what was written.
    manifest['content_scripts'][0]['js'].append('integration-probe.js')
    (extension / 'manifest.json').write_text(json.dumps(manifest))
    shutil.copyfile(ROOT / 'tests/integration-probe.js', extension / 'integration-probe.js')
    with (extension / 'background.js').open('a') as file:
        file.write('''
// Test-only activation hook in the temporary extension copy.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'testActivate' || sender.tab?.id === undefined) return;
    withTabState(sender.tab.id, async (_state, key) => {
        await chrome.storage.session.set({ [key]: { enabled: true, selection: null } });
        await broadcast(sender.tab.id, { action: 'setSelectionAvailability', available: true });
    }).then(() => sendResponse({ activated: true }), () => sendResponse({ activated: false }));
    return true;
});
''')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            content = b'<!doctype html><html><body style="margin:0;font:16px/24px monospace"><div style="position:absolute;left:40px;top:40px">Hello HTTP</div></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        command = [
            browser, '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
            '--no-first-run', '--disable-background-networking', '--no-proxy-server',
            '--host-resolver-rules=MAP freeform.test 127.0.0.1',
            f'--user-data-dir={directory / "extension-profile"}',
            f'--disable-extensions-except={extension}', f'--load-extension={extension}',
            '--remote-debugging-port=0', f'http://freeform.test:{server.server_port}/'
        ]
        with (directory / 'integration.log').open('w') as log:
            instance = Browser(command, directory / 'extension-profile', log)
            try:
                deadline = time.monotonic() + 20
                while True:
                    snapshot = instance.evaluate('''(() => {
                        const output = document.getElementById('integration-results');
                        return { complete: output?.dataset.complete === 'true', results: output?.textContent || '[]' };
                    })()''')
                    if snapshot['complete']:
                        break
                    if time.monotonic() > deadline:
                        raise SystemExit('Installed-extension checks timed out: ' + snapshot['results'])
                    time.sleep(0.05)
            finally:
                instance.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    results = json.loads(snapshot['results'])
    for test in results:
        print(('PASS ' if test['passed'] else 'FAIL ') + test['name'])
        if not test['passed']:
            print(test['error'])
    passed = sum(test['passed'] for test in results)
    print(f'{passed}/{len(results)} installed-extension checks passed')
    if passed != len(results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
