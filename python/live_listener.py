import socket
import re
import json
import threading
from robot.libraries.BuiltIn import BuiltIn
from robot.api import logger


class live_listener:  # <--- Changed class name to match filename
    ROBOT_LISTENER_API_VERSION = 3

    def __init__(self, port="8765"):
        self.port = int(port)
        self.server_socket = None
        self.client_socket = None
        self.is_session_active = False
        self.ready_event = threading.Event()
        self.connection_thread = None

    def start_suite(self, data, result):
        """Starts the socket server when the suite begins."""
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(
            socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind(('127.0.0.1', self.port))
        self.server_socket.listen(1)
        logger.console(
            f"Live Listener waiting for VS Code on port {self.port}...")

        self.connection_thread = threading.Thread(
            target=self._accept_connection)
        self.connection_thread.daemon = True
        self.connection_thread.start()

    def _accept_connection(self):
        """Accepts the VS Code connection in the background."""
        try:
            self.client_socket, addr = self.server_socket.accept()
            logger.console("\n🟢 VS Code connected! Live session active.")
            self.is_session_active = True
            self.ready_event.set()
        except Exception as e:
            logger.console(f"Connection error: {e}")

    def start_test(self, data, result):
        """Pauses the test immediately after setup to wait for user commands."""
        # We wait for the client to connect before pausing
        self.ready_event.wait(timeout=10.0)

        if self.is_session_active:
            logger.console("Test paused. Waiting for commands from VS Code...")
            self._listen_for_commands()

    def _listen_for_commands(self):
        """The main loop that receives commands from VS Code one line at a time."""
        buffer = ""
        while self.is_session_active and self.client_socket:
            try:
                data = self.client_socket.recv(4096).decode('utf-8')
                if not data:
                    break

                buffer += data
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    if line.strip():
                        self._process_command(line.strip())
            except Exception as e:
                logger.console(f"Socket error: {e}")
                break

    def _process_command(self, message_str):
        """Parses the JSON command and executes the keyword."""
        try:
            msg = json.loads(message_str)
            command = msg.get("command")

            if command == "EXIT_SESSION":
                self.is_session_active = False
                logger.console("\n🔴 Ending live session.")

            elif command == "EXECUTE":
                # We expect exactly one line/keyword block from the extension queue
                lines = msg.get("lines", [])
                if lines:
                    self._execute_keyword(lines[0])

        except json.JSONDecodeError:
            logger.console("Failed to decode command from VS Code.")

    def _execute_keyword(self, keyword_string):
        """Safely executes a single Robot Framework keyword string and catches errors."""
        builtin = BuiltIn()

        # 1. Parse the string into keyword name and arguments
        # We split by '    ' (four spaces) or '\t' (tab), which are Robot's default separators

        parts = re.split(r'(?:\t| {3,})', keyword_string)

        if not parts:
            self._send_status("EXECUTING_DONE")
            return

        # Handle variable assignment if the line starts with ${VAR}=
        assign = []
        kw_name = ""
        args = []

        if "=" in parts[0] and parts[0].startswith("$"):
            assign.append(parts[0])
            kw_name = parts[1] if len(parts) > 1 else ""
            args = parts[2:] if len(parts) > 2 else []
        else:
            kw_name = parts[0]
            args = parts[1:] if len(parts) > 1 else []

        # 2. Execute the keyword inside a try/except block
        try:
            # We don't need to send EXECUTING_START anymore because the queue handles it

            if assign:
                # If it's assigning a variable, run it and set the variable in the suite
                result = builtin.run_keyword(kw_name, *args)
                var_name = assign[0].replace('=', '').strip()
                builtin.set_suite_variable(var_name, result)
            else:
                # Normal keyword execution
                builtin.run_keyword(kw_name, *args)

            # Success! Tell VS Code to send the next line in the queue.
            self._send_status("EXECUTING_DONE")

        except Exception as e:
            # Failure! Catch the error, log it, and tell VS Code to halt the queue.
            error_message = str(e)
            logger.console(f"\n❌ [LIVE RUNNER ERROR]: {error_message}")
            self._send_error(error_message)

    def _send_status(self, status):
        """Helper to send standard status updates to VS Code."""
        if self.client_socket:
            try:
                self.client_socket.sendall(json.dumps(
                    {"status": status}).encode() + b'\n')
            except Exception:
                pass

    def _send_error(self, error_msg):
        """Helper to send error details to VS Code."""
        if self.client_socket:
            try:
                self.client_socket.sendall(json.dumps(
                    {"status": "ERROR", "error": error_msg}).encode() + b'\n')
            except Exception:
                pass

    def close(self):
        """Cleans up the sockets when the suite ends."""
        self.is_session_active = False
        if self.client_socket:
            self.client_socket.close()
        if self.server_socket:
            self.server_socket.close()

# Note: No instantiation at the bottom!
