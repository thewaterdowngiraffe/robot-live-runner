import os
import socket
import re
import json
import threading
import uuid
from robot.libraries.BuiltIn import BuiltIn
from robot.api import logger


class live_listener:
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

        # When the loop breaks, forcefully abort Robot Framework
        # so it doesn't try to execute the rest of the test case.
        try:
            BuiltIn().run_keyword("Fatal Error", "Live session terminated by user.")
        except Exception:
            # Absolute fallback to instantly kill the terminal process if the keyword fails
            import os
            os._exit(0)

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
        """Safely executes a single Robot Framework keyword string or block and catches errors."""
        builtin = BuiltIn()
        raw_string = keyword_string.strip()

        if not raw_string:
            self._send_status("EXECUTING_DONE")
            return

        try:
            # 1. Intercept VAR syntax and translate to a keyword (Filtering out inline comments)
            if raw_string.startswith('VAR '):
                parts = [i for i in re.split(
                    r'(?:\t| {3,})', raw_string) if not i.startswith('#')]
                if len(parts) >= 3:
                    builtin.run_keyword('Set Test Variable',
                                        parts[1], *parts[2:])
                self._send_status("EXECUTING_DONE")
                return

            # 2. Intercept Blocks and Inline Control Syntax using the Macro Resource trick
            # This catches multi-line blocks AND single-line inline IFs
            is_control_syntax = (
                '\n' in raw_string or
                raw_string.startswith(('IF ', 'FOR ', 'WHILE ')) or
                raw_string == 'TRY'
            )

            if is_control_syntax:
                # Generate a unique ID to bypass Robot Framework's resource caching
                unique_id = str(uuid.uuid4())[:8]
                kw_name = f"Live Runner Macro {unique_id}"
                file_name = f"live_macro_{unique_id}.robot"

                macro_path = os.path.join(
                    os.getcwd(), file_name).replace('\\', '/')

                with open(macro_path, 'w', encoding='utf-8') as f:
                    f.write(f"*** Keywords ***\n{kw_name}\n")
                    # Indent the block so it functions as a valid keyword body
                    for line in keyword_string.split('\n'):
                        f.write(f"    {line.strip()}\n")

                # Import the uniquely named temp file and execute it
                builtin.import_resource(macro_path)
                builtin.run_keyword(kw_name)

                # Clean up the temp file
                if os.path.exists(macro_path):
                    os.remove(macro_path)

                self._send_status("EXECUTING_DONE")
                return

            parts = [i for i in re.split(
                r'(?:\t| {3,})', raw_string) if not i.startswith('#')]

            assign = []
            # Extract all leading variable assignments (e.g. ${var}, ${var}=, @{list})
            while parts and re.match(r'^[\$\@\&]\{.*?\}={0,1}$', parts[0].strip()):
                assign.append(parts.pop(0))

            if not parts:
                self._send_status("EXECUTING_DONE")
                return

            kw_name = parts[0]
            args = parts[1:]

            if assign:
                # Run the keyword and capture the result
                result = builtin.run_keyword(kw_name, *args)

                # Assign the result to the variables in the suite scope
                if len(assign) == 1:
                    var_name = assign[0].replace('=', '').strip()
                    builtin.set_suite_variable(var_name, result)
                else:
                    # Unpack the result if multiple variables were assigned
                    for i, var in enumerate(assign):
                        var_name = var.replace('=', '').strip()
                        builtin.set_suite_variable(var_name, result[i])
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
