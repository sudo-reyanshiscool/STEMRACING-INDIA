#!/usr/bin/env python3
"""Serve this folder with caching switched off, so a normal reload always shows the latest version.

    python3 team-intro/serve.py          # http://localhost:5181
    python3 team-intro/serve.py 5190     # another port
"""
import http.server
import os
import socketserver
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5181
os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", port), NoCache) as server:
    print(f"Team intro on http://localhost:{port}  (Ctrl+C to stop)")
    server.serve_forever()
