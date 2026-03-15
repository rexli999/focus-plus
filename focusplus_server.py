from __future__ import annotations

import argparse
import json
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parent
STATE_FILE = ROOT_DIR / "focusplus_state.json"
MAX_STATE_BYTES = 2 * 1024 * 1024


def atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        json.dump(payload, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


class FocusPlusHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self) -> None:
        # Keep the local app shell fresh so the browser doesn't stay on an old
        # cached build that bypasses the shared-state API.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self.handle_get_state()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self.handle_post_state()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def handle_get_state(self) -> None:
        if not STATE_FILE.exists():
            self.send_json({"exists": False, "state": None})
            return
        try:
            # Accept UTF-8 files with or without a BOM so manual restores from
            # Windows tools don't break the first shared-state read.
            with STATE_FILE.open("r", encoding="utf-8-sig") as handle:
                state = json.load(handle)
        except (OSError, json.JSONDecodeError) as error:
            self.send_json(
                {"exists": False, "state": None, "error": f"Failed to read shared state: {error}"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json({"exists": True, "state": state})

    def handle_post_state(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return
        if content_length <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing request body")
            return
        if content_length > MAX_STATE_BYTES:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "State payload is too large")
            return
        try:
            body = self.rfile.read(content_length)
            state = json.loads(body.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(HTTPStatus.BAD_REQUEST, "State payload must be valid JSON")
            return
        if not isinstance(state, dict):
            self.send_error(HTTPStatus.BAD_REQUEST, "State payload must be a JSON object")
            return
        try:
            atomic_write_json(STATE_FILE, state)
        except OSError as error:
            self.send_json(
                {"ok": False, "error": f"Failed to write shared state: {error}"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json({"ok": True, "state": state})

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve Focus+ and persist shared state to disk.")
    parser.add_argument("--host", default="localhost", help="Host interface to bind.")
    parser.add_argument("--port", default=8000, type=int, help="Port to listen on.")
    parser.add_argument("--state-file", default=str(STATE_FILE), help="Path to the shared state JSON file.")
    return parser.parse_args()


def main() -> None:
    global STATE_FILE
    args = parse_args()
    STATE_FILE = Path(args.state_file).resolve()
    server = ThreadingHTTPServer((args.host, args.port), FocusPlusHandler)
    print(f"Focus+ server running at http://{args.host}:{args.port}/")
    print(f"Shared state file: {STATE_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Focus+ server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
