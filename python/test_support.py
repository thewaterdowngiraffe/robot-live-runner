import pytest
import support
import re


@pytest.mark.dependency(name="spliter")
@pytest.mark.parametrize('spacing', ["   ", "\t"])
@pytest.mark.parametrize('string,output', [
    ("hello world  # drop", "hello world  # drop"),
    ("hello world  #   drop", "hello world  #   drop"),
    ("hello world   #   drop", "hello world"),
    ("hello world   \n#   drop", "hello world   \n#   drop"),
    ("hello world", "hello world"),
])
def test_get_keyword_parts_comments(string, output, spacing):
    assert "   ".join(support.get_keyword_parts(
        re.sub(r"  {3,}", spacing, string))) == output


@pytest.mark.dependency(depends=["spliter"])
@pytest.mark.parametrize('var_count', list(range(0, 11)))
@pytest.mark.parametrize('scope', ["local", "global", "test", "suite", ""])
def test_map_var_to_set_variable_lenght(var_count, scope):
    message = "VAR    "+"    ".join(["input"]*var_count)
    if scope == "":
        var_count += 1
    message += "    scope="+scope
    print(message)
    if var_count < 2:
        with pytest.raises(AssertionError):
            support.map_var_to_set_variable(message)


@pytest.mark.dependency(depends=["spliter"])
@pytest.mark.parametrize('scope_spelling,match', [("scope=", True), ("SCOPE=", False), ("", False)])
@pytest.mark.parametrize('scope', ["local", "global", "test", "suite", ""])
@pytest.mark.parametrize("equalSign", [True, False])
@pytest.mark.parametrize("badorder", [True, False])
def test_map_var_to_set_variable_scope(scope_spelling, match, scope, equalSign, badorder):
    if scope == "":
        match = False
    if badorder:
        in_str = f"VAR    ${{test}}{["", "="][equalSign]}    {scope_spelling}{scope}    value"
    else:
        in_str = f"VAR    ${{test}}{["", "="][equalSign]}    value    {scope_spelling}{scope}"

    if match:
        result = support.map_var_to_set_variable(in_str)
        assert result.startswith(
            f"Set {scope} Variable"), f"{in_str}, {result} failed start with check"
        assert "${test}" in result
        assert "${test}=" not in result
    else:
        result = support.map_var_to_set_variable(
            in_str)
        assert result.startswith(
            f"${{test}}{["", "="][equalSign]}    Set Variable"), \
            f"{in_str}, {result} failed start with check"
        assert f"${{test}}{["", "="][equalSign]}" in result


@pytest.mark.dependency(depends=["spliter"])
@pytest.mark.parametrize("in_str,out_str", [
    ("VAR test mapping", "VAR test mapping"),
    ("VAR test   mapping", "VAR test   mapping"),
    ("VaR  test mapping", "VaR  test mapping"),
    ("VAR   ${name}   test", "${name}    Set Variable    test"),
    ("Log To Console", "Log To Console"),
])
def test_map_var_to_set_variable_skip(in_str, out_str):
    assert support.map_var_to_set_variable(in_str) == out_str
