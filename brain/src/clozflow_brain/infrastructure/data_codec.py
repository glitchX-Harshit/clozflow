"""Authenticated local payload encryption; Windows keys are protected by DPAPI."""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from threading import RLock

from cryptography.fernet import Fernet
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

PREFIX = "cfenc1:"
_key_lock = RLock()


def _dpapi(data: bytes, *, decrypt: bool = False) -> bytes:
    if sys.platform != "win32":
        raise OSError("Windows DPAPI-protected data keys require Windows")

    import ctypes
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    target = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.restype = wintypes.BOOL
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError(ctypes.get_last_error(), "Windows data key protection failed")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


@lru_cache(maxsize=8)
def _cipher(path: str) -> Fernet:
    with _key_lock:
        return _load_cipher(path)


def _load_cipher(path: str) -> Fernet:
    key_path = Path(path).resolve()
    if not key_path.exists():
        key_path.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        encoded = b"dpapi:" + _dpapi(key) if os.name == "nt" else key
        try:
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
    encoded = key_path.read_bytes()
    key = _dpapi(encoded[6:], decrypt=True) if encoded.startswith(b"dpapi:") else encoded
    return Fernet(key)


def encode(value: str) -> str:
    path = os.getenv("CEB_DATA_KEY_FILE")
    if not path or value.startswith(PREFIX):
        return value
    return PREFIX + _cipher(path).encrypt(value.encode("utf-8")).decode("ascii")


def decode(value: str) -> str:
    if not value.startswith(PREFIX):
        return value  # Compatible reads allow explicit migration of older stores.
    path = os.getenv("CEB_DATA_KEY_FILE")
    if not path:
        raise RuntimeError("CEB_DATA_KEY_FILE is required to read encrypted data")
    return _cipher(path).decrypt(value[len(PREFIX):].encode("ascii")).decode("utf-8")


class SecureText(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encode(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return decode(value) if value is not None else None
