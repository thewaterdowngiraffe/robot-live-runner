import socket
import json
import re
import sys
import threading
import time
from robot.libraries.BuiltIn import BuiltIn

ROBOT_LISTENER_API_VERSION = 2

class live_listener:
    ROBOT_LISTENER_API_VERSION = 2

    def __init__(self, port=8765):
        self.port = int(port)
        self.server_socket = None
        self.client_socket = None
        self.session_active = False
        self.is_paused = False
        self.stop_current_batch = False
        self.builtin = BuiltIn()

    def start_test(self, name, attributes):
        """Called after test setup has run, before test body keywords execute."""
        print(f"\n[LIVE RUNNER] Setup complete. Initializing Live Testing Session on port {self.port}...")
        self.session_active = True

        # Start socket server
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind(('127.0.0.1', self.port))
        self.server_socket.listen(1)
        print(f"[LIVE RUNNER] Waiting for VS Code to connect...")

        self.client_socket, _ = self.server_socket.accept()
        print(f"[LIVE RUNNER] Connected to VS Code. Session active.")

        # Interactive loop - keeps the browser/system state open
        self._command_loop()

    def _command_loop(self):
        buffer = ""
        while self.session_active:
            try:
                data = self.client_socket.recv(4096).decode('utf-8')
                if not data:
                    break
                buffer += data
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if line.strip():
                        self._handle_payload(json.loads(line))
            except Exception as e:
                print(f"[LIVE RUNNER ERROR] {e}")
                break

    def _handle_payload(self, payload):
        cmd = payload.get("command")

        if cmd == "EXECUTE":
            keywords = payload.get("lines", [])
            self._execute_batch(keywords)

        elif cmd == "PAUSE":
            self.is_paused = True
            print("[LIVE RUNNER] Execution Paused.")
            self._send_status("PAUSED")

        elif cmd == "RESUME":
            self.is_paused = False
            print("[LIVE RUNNER] Execution Resumed.")
            self._send_status("RESUMED")

        elif cmd == "STOP_BATCH":
            self.stop_current_batch = True
            self.is_paused = False
            print("[LIVE RUNNER] Stopping current running batch...")

        elif cmd == "EXIT_SESSION":
            print("[LIVE RUNNER] Exiting Live Session. Proceeding to teardown...")
            self.session_active = False
            if self.client_socket:
                self.client_socket.close()
            if self.server_socket:
                self.server_socket.close()

    def _execute_batch(self, lines):
        self.stop_current_batch = False
        self.is_paused = False
        self._send_status("EXECUTING_START")

        for line in lines:
            if self.stop_current_batch or not self.session_active:
                print("[LIVE RUNNER] Batch execution stopped.")
                break

            # Handle Pause state
            while self.is_paused and not self.stop_current_batch:
                time.sleep(0.1)

            line_clean = line.strip()
            if not line_clean or line_clean.startswith("#"):
                continue

            try:
                print(f"[LIVE RUNNER RUNNING] -> {line_clean}")
                self._run_single_line(line_clean)
            except Exception as err:
                print(f"[LIVE RUNNER ERROR] Failed executing '{line_clean}': {err}")

        self._send_status("EXECUTING_DONE")

    def _run_single_line(self, line):
        # Handle variable assignments e.g. ${val}=  Get Text  locator
        var_assign_match = re.match(r'^(\${[a-zA-Z0-9_]+}|\@{[a-zA-Z0-9_]+}|\&{[a-zA-Z0-9_]+})\s*=\s*(.*)', line)
        if var_assign_match:
            var_name = var_assign_match.group(1)
            rest = var_assign_match.group(2).strip()
            tokens = re.split(r'\s{2,}|\t', rest)
            kw_name = tokens[0]
            args = tokens[1:] if len(tokens) > 1 else []
            result = self.builtin.run_keyword(kw_name, *args)
            self.builtin.set_test_variable(var_name, result)
        else:
            tokens = re.split(r'\s{2,}|\t', line)
            kw_name = tokens[0]
            args = tokens[1:] if len(tokens) > 1 else []
            self.builtin.run_keyword(kw_name, *args)

    def _send_status(self, status):
        try:
            if self.client_socket:
                msg = json.dumps({"status": status}) + "\n"
                self.client_socket.sendall(msg.encode('utf-8'))
        except Exception:
            pass

    def end_test(self, name, attributes):
        print("\n[LIVE RUNNER] Live Test Session closed. Teardowns completed.")