"""Minimal local Chrome DevTools client for installed-extension integration tests."""
import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
from urllib.request import ProxyHandler, build_opener


class Browser:
    def __init__(self, command, profile, log):
        self.socket = None
        self.process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=log)
        self.message_id = 0
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            deadline = time.monotonic() + 15
            while not port_file.exists():
                if self.process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Chromium did not start its debugging endpoint')
                time.sleep(0.05)
            port = int(port_file.read_text().splitlines()[0])
            opener = build_opener(ProxyHandler({}))
            while True:
                with opener.open(f'http://127.0.0.1:{port}/json/list', timeout=2) as response:
                    pages = [page for page in json.load(response) if page['type'] == 'page']
                if pages:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError('Chromium did not create a page')
                time.sleep(0.05)
            path = '/' + pages[0]['webSocketDebuggerUrl'].split('/', 3)[3]
            self.socket = socket.create_connection(('127.0.0.1', port), timeout=5)
            key = base64.b64encode(os.urandom(16)).decode()
            self.socket.sendall((f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n'
                                 f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
            header = b''
            while not header.endswith(b'\r\n\r\n'):
                header += self._read(1)
            if b' 101 ' not in header.split(b'\r\n')[0]:
                raise RuntimeError('Chrome rejected the debugging WebSocket')
        except Exception:
            self.close()
            raise

    def _read(self, length):
        data = b''
        while len(data) < length:
            part = self.socket.recv(length - len(data))
            if not part:
                raise RuntimeError('Chrome closed the debugging connection')
            data += part
        return data

    def _send(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += b'\xfe' + struct.pack('!H', length)
        else:
            header += b'\xff' + struct.pack('!Q', length)
        self.socket.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))

    def _receive(self):
        chunks = []
        while True:
            first, second = self._read(2)
            length = second & 0x7f
            if length == 126:
                length = struct.unpack('!H', self._read(2))[0]
            elif length == 127:
                length = struct.unpack('!Q', self._read(8))[0]
            mask = self._read(4) if second & 0x80 else None
            payload = self._read(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            opcode = first & 0xf
            if opcode == 9:
                self._send(payload, 10)
                continue
            if opcode == 8:
                raise RuntimeError('Chrome closed the debugging WebSocket')
            if opcode in (0, 1):
                chunks.append(payload)
                if first & 0x80:
                    return json.loads(b''.join(chunks))

    def evaluate(self, expression):
        self.message_id += 1
        self._send(json.dumps({'id': self.message_id, 'method': 'Runtime.evaluate',
                              'params': {'expression': expression, 'returnByValue': True}}).encode())
        while True:
            response = self._receive()
            if response.get('id') == self.message_id:
                if 'error' in response or 'exceptionDetails' in response.get('result', {}):
                    raise RuntimeError(str(response))
                return response['result']['result'].get('value')

    def close(self):
        if self.socket:
            self.socket.close()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
