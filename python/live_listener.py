import os
import socket
import re
import json
import threading
import uuid
import tempfile
from robot.api import logger
from robot.libraries.BuiltIn import BuiltIn
from support import map_var_to_set_variable, get_keyword_parts
import signal


class live_listener:
    ROBOT_LISTENER_API_VERSION = 3

    def __init__(self, port="8765"):
        self.port = int(port)
        self.server_socket = None
        self.client_socket = None
        self.is_session_active = False
        self.ready_event = threading.Event()
        self.connection_thread = None
        # self.libraries = {}
        self.imported_resources = {}

        self.signal_received_count = 0
        # Intercept both Ctrl+C (SIGINT) and kill/termination (SIGTERM) signals
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum, frame):
        logger.console(
            'Ignoring users attempt to exit, if you are trying to abort, please use the stop live test button')
        pass   # I dont want you to do anything, use the extension.

    def _make_relative_to_execdir(self, absolute_path):
        """Converts an absolute path to be relative to the Robot Framework ${EXECDIR}."""
        try:
            # Fetch the execution directory dynamically
            exec_dir = BuiltIn().get_variable_value("${EXECDIR}")
            if not exec_dir:
                exec_dir = os.getcwd()
        except Exception:
            # Fallback if BuiltIn isn't initialized yet
            exec_dir = os.getcwd()

        try:
            rel_path = os.path.relpath(absolute_path, exec_dir)
            # Normalize to forward slashes for cross-platform/VS Code consistency
            return rel_path.replace('\\', '/')
        except ValueError:
            # ValueError triggers on Windows if the files are on completely different drives (e.g. C: vs D:)
            return absolute_path.replace('\\', '/')

    def _extract_source(self, arg1, arg2):
        """Universally hunts for the absolute path in the listener arguments."""

        # 1. NEW: For variables, Robot Framework often just passes the absolute path string directly as arg1
        if isinstance(arg1, str):
            return arg1

        if isinstance(arg1, dict) and arg1.get('source') and str(arg1.get('name', "")).endswith(".py"):
            return str(arg1.get('source'))

        # 2. Check if the first argument is an object with a .source property (e.g., ResourceFile)
        if hasattr(arg1, 'source') and arg1.source:
            return str(arg1.source)

        # 3. Check if the second argument is an object with a .source property (e.g., Import object)
        if hasattr(arg2, 'source') and arg2.source:
            return str(arg2.source)

        # 4. Check if the second argument is a dictionary containing 'source' (older RF versions)
        if isinstance(arg2, dict) and arg2.get('source'):
            return str(arg2.get('source'))

        return None

    def _reimport(self, file_path: str, import_type: str):
        file_name, file_ext = os.path.basename(
            file_path).rsplit('.', maxsplit=1)

        macro_path = tempfile.NamedTemporaryFile(dir=os.path.dirname(
            file_path), mode="w+", suffix=f".{file_ext}", delete=False)

        builtin = BuiltIn()
        try:
            macro_path.write(open(file_path, 'r', encoding='utf-8').read())
            macro_path.close()

            temp_file_name = os.path.basename(
                macro_path.name).removesuffix(f".{import_type}")
            temp_file_path = macro_path.name.replace('\\', '/')
            if import_type == 'resource':
                builtin.import_resource(temp_file_path)
            else:
                builtin.import_variables(temp_file_path)

            # get current
            result = builtin.set_library_search_order()
            # set new import order
            builtin.set_library_search_order(f"{temp_file_name}", *result)
            logger.console(
                f"modified search order, added reimport to top of search.")

            self._send_status("EXECUTING_DONE")

        finally:
            if os.path.exists(macro_path.name):
                try:
                    os.remove(macro_path.name)
                except Exception as e:
                    print(
                        f"failed to remove `{macro_path.name}` please delete the file manually.\nError message: {e}"
                    )

    def resource_import(self, arg1, arg2):
        """Robot Framework listener hook for .resource / .robot files."""
        source = self._extract_source(arg1, arg2)
        if source and os.path.exists(source):
            rel_path = self._make_relative_to_execdir(source)
            current = self.imported_resources.get(rel_path)
            if self.is_session_active and current is not None:
                # already imported and session is live, make a new file, import it and set search order.
                self._reimport(source, "resource")
            self.imported_resources[rel_path] = {
                "rel": 'resource', "full": source}

    def variables_import(self, arg1, arg2):
        """Robot Framework listener hook for .py variable files."""
        source = self._extract_source(arg1, arg2)
        if source and os.path.exists(source):
            rel_path = self._make_relative_to_execdir(source)
            current = self.imported_resources.get(rel_path)
            if self.is_session_active and current is not None:
                # already imported and session is live, make a new file, import it and set search order.
                self._reimport(source, "variable")
            self.imported_resources[rel_path] = {
                "rel": 'variable', "full": source}

    def start_suite(self, data, result):
        """Starts the socket server when the suite begins, preventing duplicate binding on nested suites."""
        if self.server_socket is not None:
            return

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
            logger.console(
                "\n\U0001f7e2 VS Code connected! Live session active.")
            self.is_session_active = True
            # logger.console(self.imported_resources)
            self.ready_event.set()
        except Exception as e:
            logger.console(f"Connection error: {e}")

    def start_test(self, data, result):
        """Pauses the test immediately after setup to wait for user commands."""

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

        try:
            # setting to pass so that the test exits cleanly
            BuiltIn().run_keyword("Pass Execution", "Live session terminated by user.")
        except Exception:
            #
            import os
            os._exit(0)

    def _process_command(self, message_str):
        """Parses the JSON command and executes the keyword."""
        try:
            msg = json.loads(message_str)
            command = msg.get("command")

            if command == "EXIT_SESSION":
                self.is_session_active = False
                logger.console("\n\U0001f534 Ending live session.")

            elif command == "EXECUTE":
                lines = msg.get("lines", [])
                if lines:
                    self._execute_keyword(lines[0])
            elif command == "GET_IMPORTS":
                # Expose the captured imports back to VS Code
                if self.client_socket:
                    payload = {
                        "status": "IMPORTS_LIST",
                        "imports": {key: val['rel'] for key, val in self.imported_resources.items()}
                    }
                    self.client_socket.sendall(
                        json.dumps(payload).encode() + b'\n')
        except json.JSONDecodeError:
            logger.console("Failed to decode command from VS Code.")

    def _map_var_to_set_variable(self, raw_string) -> str | None:
        """Calls the var mapping handler, and processes the return and handles the error."""

        try:
            return map_var_to_set_variable(raw_string)
        except AssertionError as e:
            error_message = str(e)
            logger.console(
                f"\n\U0000274c [LIVE RUNNER ERROR]: {error_message}")
            self._send_error(error_message)
            return None

    def _execute_keyword(self, keyword_string):
        """Safely executes a single Robot Framework keyword string or block and catches errors."""
        builtin = BuiltIn()

        raw_string = keyword_string.strip()
        if not raw_string:
            self._send_status("EXECUTING_DONE")
            return
        try:

            raw_string = self._map_var_to_set_variable(raw_string)
            if raw_string is None:
                return None

            is_control_syntax = (
                '\n' in raw_string or
                raw_string.startswith(('IF ', 'FOR ', 'WHILE ')) or
                raw_string == 'TRY'
            )

            if is_control_syntax:
                # If control syntax create a copy to a temp file, import than remove it.
                unique_id = str(uuid.uuid4())[:8]
                kw_name = f"Live Runner Macro {unique_id}"
                file_name = f"live_macro_{unique_id}.robot"

                temp_dir = tempfile.gettempdir()
                macro_path = os.path.join(
                    temp_dir, file_name).replace('\\', '/')

                with open(macro_path, 'w', encoding='utf-8') as f:
                    f.write(f"*** Keywords ***\n{kw_name}\n")
                    #
                    for line in keyword_string.split('\n'):
                        f.write(f"    {line.strip()}\n")

                try:
                    builtin.import_resource(macro_path)
                    builtin.run_keyword(kw_name)
                    self._send_status("EXECUTING_DONE")
                finally:
                    if os.path.exists(macro_path):
                        try:
                            os.remove(macro_path)
                        except Exception as e:
                            print(
                                f"failed to remove `{macro_path}` please delete the file manually.\nError message: {e}"
                            )
                return
            parts = get_keyword_parts(raw_string)

            assign = []
            while parts and re.match(r'^[\$\@\&]\{.*?\}=?$', parts[0].strip()):
                assign.append(parts.pop(0))

            if not parts:
                self._send_status("EXECUTING_DONE")
                return

            kw_name = parts[0]
            args = parts[1:]

            if assign:
                result = builtin.run_keyword(kw_name, *args)

                # Check if any assigned variable is a list variable (starts with @)
                list_var_index = -1
                for idx, var in enumerate(assign):
                    if var.startswith('@{'):
                        list_var_index = idx
                        break

                if list_var_index != -1:
                    # Handle list unpacking (e.g. ${first}  @{rest}=)
                    scalar_count = list_var_index
                    for i in range(scalar_count):
                        var_name = assign[i].replace('=', '').strip()
                        builtin.set_global_variable(
                            var_name, result[i] if i < len(result) else None)

                    # Everything from the list variable onward goes into the list
                    list_var_name = assign[list_var_index].replace(
                        '=', '').strip()
                    list_values = result[scalar_count:] if scalar_count < len(result) else [
                    ]
                    builtin.set_global_variable(list_var_name, list_values)

                    # Handle any remaining scalar variables after the list variable (if any)
                    for i in range(list_var_index + 1, len(assign)):
                        var_name = assign[i].replace('=', '').strip()
                        val_idx = scalar_count + \
                            len(list_values) + (i - list_var_index - 1)
                        builtin.set_global_variable(
                            var_name, result[val_idx] if val_idx < len(result) else None)

                elif len(assign) == 1:
                    var_name = assign[0].replace('=', '').strip()
                    builtin.set_global_variable(var_name, result)
                    print(var_name, result)
                else:
                    for i, var in enumerate(assign):
                        var_name = var.replace('=', '').strip()
                        _result = result[i] if i < len(result) else None
                        builtin.set_global_variable(
                            var_name, result[i] if i < len(result) else None)
                        print(var_name, _result)
            else:

                builtin.run_keyword(kw_name, *args)

            self._send_status("EXECUTING_DONE")

        except Exception as e:
            error_message = str(e)
            logger.console(
                f"\n\U0000274c [LIVE RUNNER ERROR]: {error_message}")
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
