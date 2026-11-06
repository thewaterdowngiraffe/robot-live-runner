import re


def get_keyword_parts(raw_string: str) -> list[str]:
    """Drops comments and splits keyword parts using standard Robot Framework
    2-space or tab separation.

    :param raw_string: keyword to be executed
    :type raw_string: str
    :return: split parts for builtin library
    :rtype: list[str]
    """
    raw_string = re.sub(r"(?:\t| {2,})(?:#.*)", "", raw_string)
    parts = [i for i in re.split(
        r'(?:\t| {2,})', raw_string) if not i.startswith('#') and i]
    return parts


def map_var_to_set_variable(raw_string: str) -> str:
    """If the string starts with `VAR  ` (or `VAR\\t`), it maps to the appropriate
    `Set <Scope> Variable` command.

    - `VAR    ${test}    123` -> `Set Suite Variable    ${test}    123`
    - `VAR    ${test}    123    scope=global` -> `Set global Variable    ${test}    123`
    - `VAR    ${test}    123    scope=test` -> `Set test Variable    ${test}    123`
    - `VAR    ${test}    123    scope=suite` -> `Set suite Variable    ${test}    123`

    :param raw_string: the raw string that is to be run.
    :return: formatted code compatible with Robot Framework BuiltIn library.
    """
    processed_lines = []
    valid_scopes = {"LOCAL", "TEST", "TASK", "SUITE", "GLOBAL"}

    for line in raw_string.splitlines():
        if re.match(r'^VAR(?:\t| {2,})', line):
            parts = get_keyword_parts(line)
            scope_val = ""
            clean_parts = list(parts)

            # Only treat the LAST argument as scope= if there is still a value argument before it!
            if len(clean_parts) > 3 and clean_parts[-1].lower().startswith('scope='):
                scope_val = clean_parts.pop().rsplit("=", 1)[-1]

            assert len(clean_parts) > 2, \
                f"Missing content from VAR keyword. `{line}` -> `{parts}`"

            target_scope = scope_val.upper() if scope_val else "SUITE"
            assert target_scope in valid_scopes, \
                f"Invalid VAR scope '{scope_val}' in `{line}`"

            kw = f'Set {target_scope.capitalize()} Variable'
            var_name = clean_parts[1][
                :-1].rstrip() if clean_parts[1].endswith("=") else clean_parts[1]

            mapped_line = "    ".join([kw, var_name, *clean_parts[2:]])
            processed_lines.append(mapped_line)
        else:
            processed_lines.append(line)

    return "\n".join(processed_lines)
