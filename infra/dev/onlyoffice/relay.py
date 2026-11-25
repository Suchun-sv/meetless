#!/usr/bin/env python3
"""TCP-to-Unix byte relay, run in meetless-onlyoffice-files (U3, contract 12.6).

DocumentServer fetches http://meetless-onlyoffice-files:8080/v1/office-files/<ticket>. Each TCP
connection is relayed byte for byte to the server's Unix socket, which is bind-mounted read-only at
/run/meetless. HTTP is never parsed. If the socket is missing (server not running, or not built yet)
the connection is closed without a byte, so the caller sees a failure rather than a made-up status.

Stdlib only. Env: RELAY_HOST (0.0.0.0), RELAY_PORT (8080; 0 picks a free port), RELAY_SOCKET
(/run/meetless/files.sock), RELAY_IDLE_SECONDS (300).
"""
import os
import signal
import socket
import sys
import threading

HOST = os.environ.get("RELAY_HOST", "0.0.0.0")
PORT = int(os.environ.get("RELAY_PORT", "8080"))
SOCKET = os.environ.get("RELAY_SOCKET", "/run/meetless/files.sock")
IDLE = float(os.environ.get("RELAY_IDLE_SECONDS", "300"))

_last_error = None
_lock = threading.Lock()


def log(msg):
    print(f"relay: {msg}", file=sys.stderr, flush=True)


def note_upstream(err):
    """Log upstream state changes only, so health probes do not flood the log."""
    global _last_error
    with _lock:
        if err != _last_error:
            log(f"upstream {SOCKET}: {err or 'ok'}")
            _last_error = err


def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle(client):
    upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        upstream.connect(SOCKET)
    except OSError as e:
        note_upstream(e.strerror or str(e))
        upstream.close()
        client.close()
        return
    note_upstream(None)
    client.settimeout(IDLE)
    upstream.settimeout(IDLE)
    back = threading.Thread(target=pump, args=(upstream, client), daemon=True)
    back.start()
    pump(client, upstream)
    back.join()
    client.close()
    upstream.close()


def main():
    # PID 1 in a container ignores SIGTERM by default; exit at once on docker stop.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    server = socket.create_server((HOST, PORT))
    log(f"listening on {HOST}:{server.getsockname()[1]} -> {SOCKET}")
    while True:
        client, _ = server.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
