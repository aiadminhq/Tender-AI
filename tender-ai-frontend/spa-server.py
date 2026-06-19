#!/usr/bin/env python3
"""Static SPA server for the Claude Preview MCP.

The preview MCP refuses to exec the project's node binary but runs python3
fine, and its browser navigates to http://localhost:<port>. So we serve the
production build (dist/) with python, adding two things over `-m http.server`:

  1. SPA fallback — any path that is not an existing file is served
     index.html, so client-side routes (/tenders, /kanban, /rules) work on
     direct navigation and hard refresh.
  2. Dual-stack bind on "::" (IPV6_V6ONLY=0), exactly like CPython's own
     http.server DualStackServer, so `localhost` reaches it whether it
     resolves to ::1 or 127.0.0.1. Binding plain 0.0.0.0 (IPv4) is NOT
     reachable via localhost->::1 and yields a chrome-error blank page.

cwd-safe: directory is pinned to an absolute path, so SimpleHTTPRequestHandler
never calls os.getcwd() (denied in the MCP sandbox).

Usage: python3 spa-server.py <dist_dir> <port>
"""
import os
import sys
import socket
import contextlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DIST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "dist"
)
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 5180


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def send_head(self):
        path = self.translate_path(self.path)
        # Existing file or directory → serve as-is. Otherwise SPA fallback.
        if not os.path.isdir(path) and not os.path.exists(path):
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("[spa] " + (fmt % args) + "\n")


class DualStackServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()


httpd = DualStackServer(("::", PORT), SPAHandler)
sys.stderr.write(f"[spa] serving {DIST} on [::]:{PORT} (dual-stack)\n")
httpd.serve_forever()
