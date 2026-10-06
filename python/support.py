"""This is a support class that will be used for data parsing,
formating and other reusable logic that can be unit tested.

TODO add the unit tests.
"""
import re


def get_keyword_parts(raw_string: str) -> list[str]:
    """Drop the comments first, the extension will remove comments within a
    multi line if they are in the correct spot. Given that there should not be any comments, this
    will handle any that should not be in the script.

    :param raw_string: keyword to be executed
    :type raw_string: str
    :return: split so the formating can start for the builtin library
    :rtype: list[str]
    """
    # drop all comments and everything after it.
    raw_string = re.sub(r"(?:\t| {3,})(?:#.*)", "", raw_string)
    parts = [i for i in re.split(
        r'(?:\t| {3,})', raw_string) if not i.startswith('#') and i]
    return parts


def map_var_to_set_variable(raw_string: str) -> str:
    """If the string starts with `VAR  ` it will be mapped to the `set variable` command.
    > Will honor your defined scope.
    Examples

    - `VAR    ${test}    123` -> `${test}   set variable   123`
    - `VAR    ${test}    123    scope=global` -> `set global variable   ${test}   123`
    - `VAR    ${test}    123    scope=test` -> `set test variable   ${test}   123`
    - `VAR    ${test}    123    scope=suite` -> `set suite variable   ${test}   123`

    TODO write unit tests for this.

    :param raw_string: the raw string that is to be ran.
    :type raw_string: str
    :return: formated and good to use code that robot framework will be able to
        run via the builtin library.
    :rtype: str
    """
    if raw_string.startswith('VAR  '):
        # If `VAR` Map to correct legacy declaration then allow keyword to resume.
        parts = get_keyword_parts(raw_string)
        scope = [i for i in parts if i.startswith('scope=')]
        for i in scope:
            parts.pop(parts.index(i))
            scope = scope[0].removeprefix('scope=')
        assert len(parts) > 2, \
            f"Missing content from keyword. `{raw_string}` -> `{parts}`"
        if len(scope) != 0:
            kw = f'Set {scope} Variable'
            return "    ".join(
                [kw, parts[1].removesuffix("="), *parts[2:]])

        return "    ".join([parts[1], 'Set Variable', *parts[2:]])
    return raw_string
