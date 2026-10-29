#!/usr/bin/env python3
"""Stdio MCP for the camera in this project's .env.

Agents never see the password. Login, user, and account keys are refused.
"""

import base64
import json
import os
import re
import shlex
import ssl
import sys
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import quote

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,63}$")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.\[\]]{0,180}$")
SECRET = ("password", "passwd", "pwd", "secret", "token", "credential")
AUTH_PART = {"user", "users", "account", "accounts", "authority", "userglobal"}

TOOLS = [
    {
        "name": "snapshot",
        "description": "Take one JPEG from the camera. Channel is 1 for the main sensor.",
        "inputSchema": {
            "type": "object",
            "properties": {"channel": {"type": "integer", "minimum": 0, "maximum": 8}},
        },
    },
    {
        "name": "get_config",
        "description": "Read one Dahua config section (Encode, Record, VideoColor, VideoInOptions, MotionDetect, Lighting, VideoWidget, General, Network, StorageGroup). Password lines are redacted. User and account sections are refused.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "contains": {"type": "string", "description": "Keep only lines containing this text"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "set_config",
        "description": "Change camera settings. Each update is Key=value using Dahua keys without the table. prefix, e.g. Encode[0].MainFormat[0].Video.BitRate=2048. Password, login, user, and account keys are refused.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "updates": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Key=value pairs",
                }
            },
            "required": ["updates"],
        },
    },
]


def load_env(path=ENV_PATH):
    env = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip().removeprefix("export ").strip()] = env_value(value)
    return env


def env_value(raw):
    """A value as bash reads it: the setup writes 'it'\\''s' for it's."""
    try:
        words = shlex.split(raw, comments=True)
    except ValueError:
        return raw.strip()
    return words[0] if words else ""


def auth_key(key):
    low = key.lower()
    if "login" in low or any(word in low for word in SECRET):
        return True
    parts = [p for p in re.split(r"[.\[\]]+", low) if p]
    return any(p in AUTH_PART for p in parts)


def redact(text, password):
    if password:
        text = text.replace(password, "<redacted>")
    kept = []
    for line in text.splitlines():
        if "=" in line:
            key, _value = line.split("=", 1)
            if auth_key(key):
                line = key + "=<redacted>"
        kept.append(line)
    return "\n".join(kept)


def parse_updates(items):
    if isinstance(items, str):
        items = [items]
    if not isinstance(items, list) or not items:
        raise ValueError("updates must be a non-empty list of Key=value")
    pairs = []
    for item in items:
        if not isinstance(item, str) or "=" not in item:
            raise ValueError("expected Key=value")
        key, value = item.split("=", 1)
        key = key.strip().removeprefix("table.")
        if not KEY_RE.match(key) or auth_key(key):
            raise ValueError("key not allowed")
        if any(c in value for c in "\r\n") or len(value) > 1000:
            raise ValueError("bad value")
        pairs.append((key, value))
    return pairs


class Camera:
    def __init__(self, env):
        self.password = env["CAMERA_PASSWORD"]
        scheme = env.get("CAMERA_SCHEME", "http")
        if scheme not in ("http", "https"):
            raise ValueError("CAMERA_SCHEME must be http or https")
        port = env.get("CAMERA_PORT") or (443 if scheme == "https" else 80)
        self.base = f"{scheme}://{env['CAMERA_IP_ADDRESS']}:{port}"
        passwords = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        passwords.add_password(None, self.base, env["CAMERA_USERNAME"], self.password)
        # ponytail: camera cert is self-signed; pin it if the wrong device answering matters
        context = ssl._create_unverified_context()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=context),
            urllib.request.HTTPDigestAuthHandler(passwords),
        )

    def fetch(self, path):
        if not path.startswith("/cgi-bin/"):
            raise ValueError("refused")
        try:
            with self.opener.open(self.base + path, timeout=25) as response:
                return response.read()
        except HTTPError as exc:
            detail = redact(exc.read(400).decode("utf-8", "replace"), self.password)
            raise RuntimeError(f"camera HTTP {exc.code}: {detail}") from None
        except URLError as exc:
            raise RuntimeError(f"camera unreachable: {exc.reason}") from None


def camera():
    if not hasattr(camera, "client"):
        camera.client = Camera(load_env())
    return camera.client


def get_config(name, contains=""):
    if not isinstance(name, str) or not NAME_RE.match(name) or auth_key(name):
        raise ValueError("config name not allowed")
    body = camera().fetch(f"/cgi-bin/configManager.cgi?action=getConfig&name={quote(name)}")
    text = redact(body.decode("utf-8", "replace"), camera().password)
    if contains:
        text = "\n".join(line for line in text.splitlines() if contains.lower() in line.lower())
    if len(text) > 80000:
        text = text[:80000] + "\n...truncated"
    return text


def set_config(updates):
    pairs = parse_updates(updates)
    query = "&".join(quote(key, safe="[]") + "=" + quote(value, safe="") for key, value in pairs)
    body = camera().fetch("/cgi-bin/configManager.cgi?action=setConfig&" + query)
    return redact(body.decode("utf-8", "replace"), camera().password).strip()


def snapshot(channel):
    if isinstance(channel, float) and channel.is_integer():
        channel = int(channel)
    if isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel <= 8:
        raise ValueError("channel must be 0-8")
    body = camera().fetch(f"/cgi-bin/snapshot.cgi?channel={channel}")
    if not body.startswith(b"\xff\xd8"):
        raise RuntimeError(redact(body[:200].decode("utf-8", "replace"), camera().password) or "not a jpeg")
    return body


def text_result(text):
    failed = text.startswith("Error")
    result = {"content": [{"type": "text", "text": text or "(empty)"}]}
    if failed:
        result["isError"] = True
    return result


def call_tool(name, args):
    try:
        if name == "snapshot":
            jpeg = snapshot(args.get("channel", 1))
            return {
                "content": [
                    {"type": "image", "data": base64.b64encode(jpeg).decode(), "mimeType": "image/jpeg"},
                    {"type": "text", "text": f"jpeg {len(jpeg)} bytes"},
                ]
            }
        if name == "get_config":
            return text_result(get_config(args.get("name", ""), args.get("contains") or ""))
        if name == "set_config":
            return text_result(set_config(args.get("updates")))
        return text_result(f"Error unknown tool {name}")
    except Exception as exc:
        return text_result("Error " + redact(str(exc), getattr(camera, "client", None) and camera.client.password or ""))


def handle(method, params):
    if method == "initialize":
        return {
            "protocolVersion": params.get("protocolVersion") or "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "skyvision-camera", "version": "1.0.0"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        return call_tool(params.get("name", ""), params.get("arguments") or {})
    return None


def demo():
    assert auth_key("NAS[0].Password")
    assert auth_key("General.LockLoginEnable")
    assert auth_key("Account")
    assert not auth_key("Encode[0].MainFormat[0].Video.BitRate")
    assert not auth_key("VideoWidget[0].UserDefinedTitle[0].Text")
    assert parse_updates(["table.General.MachineName=skycam"]) == [("General.MachineName", "skycam")]
    try:
        parse_updates(["UserGlobal.Name=a"])
    except ValueError:
        pass
    else:
        raise SystemExit("auth key was accepted")
    assert "secret" not in redact("table.X.Password=secret\ntable.X.BitRate=1", "secret")
    assert env_value("'it'\\''s-ok'") == "it's-ok" and env_value('"a b"') == "a b" and env_value("") == ""
    assert Camera({"CAMERA_PASSWORD": "p", "CAMERA_USERNAME": "u", "CAMERA_IP_ADDRESS": "10.0.0.2"}).base == "http://10.0.0.2:80"
    print("ok")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        demo()
        return
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" not in msg:
            continue
        result = handle(msg.get("method", ""), msg.get("params") or {})
        if result is None:
            out = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "method not found"}}
        else:
            out = {"jsonrpc": "2.0", "id": msg["id"], "result": result}
        sys.stdout.write(json.dumps(out, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
