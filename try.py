#!/usr/bin/env python3
"""Open the local extension and a practice page in a temporary Chromium profile."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve-only', action='store_true', help='serve the practice page for your own browser')
    args = parser.parse_args()
    browser = shutil.which('chromium') or shutil.which('chromium-browser')
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT / 'demo'))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_port}/'
    process = None
    try:
        print(f'Practice page: {url}', flush=True)
        if args.serve_only or not browser:
            if not browser and not args.serve_only:
                print('Chromium was not found; use your own Chrome browser instead.', flush=True)
            print(f'Open chrome://extensions, enable Developer mode, and Load unpacked: {ROOT}', flush=True)
            print('Then open the practice page above. Press Ctrl+C to stop.', flush=True)
            thread.join()
        else:
            with tempfile.TemporaryDirectory(prefix='freeform-try-') as profile:
                print('Opening Chromium with the local extension loaded.', flush=True)
                print('Click the puzzle-piece menu → Freeform Text Copy, then drag over some text.', flush=True)
                print('Close the browser or press Ctrl+C to stop.', flush=True)
                try:
                    process = subprocess.Popen([
                        browser, f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
                        f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}', url,
                    ])
                    result = process.wait()
                    if result:
                        raise SystemExit(f'Chromium exited with status {result}. Try: python3 try.py --serve-only')
                finally:
                    if process is not None and process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
