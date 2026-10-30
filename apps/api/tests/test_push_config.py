"""The VAPID settings: a real key pair is accepted, a half-set trio or a
malformed key is refused at startup rather than at the first push."""
import base64

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from apps.api.config import Settings


def _pair():
    key = ec.generate_private_key(ec.SECP256R1())
    b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    private = key.private_numbers().private_value.to_bytes(32, "big")
    return b64(public), b64(private)


@pytest.fixture(autouse=True)
def _no_vapid_in_env(monkeypatch):
    # A dev container may carry real VAPID keys in its environment; these
    # tests decide the trio themselves.
    for name in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"):
        monkeypatch.delenv(name, raising=False)


def _settings(**kw):
    return Settings(jwt_secret="x" * 64, _env_file=None, **kw)


def test_push_is_off_by_default():
    s = _settings()
    assert s.push_enabled is False


def test_a_generated_pair_turns_push_on():
    pub, priv = _pair()
    s = _settings(vapid_public_key=pub, vapid_private_key=priv, vapid_subject="mailto:admin@example.com")
    assert s.push_enabled is True


def test_a_half_set_trio_is_refused():
    pub, priv = _pair()
    with pytest.raises(ValueError, match="all three or none"):
        _settings(vapid_public_key=pub, vapid_private_key=priv)


def test_the_subject_must_be_mailto_or_https():
    pub, priv = _pair()
    with pytest.raises(ValueError, match="mailto"):
        _settings(vapid_public_key=pub, vapid_private_key=priv, vapid_subject="admin@example.com")
    s = _settings(vapid_public_key=pub, vapid_private_key=priv, vapid_subject="https://ff.example")
    assert s.push_enabled


def test_a_pem_or_a_wrong_length_key_is_refused():
    pub, priv = _pair()
    with pytest.raises(ValueError, match="VAPID_PRIVATE_KEY"):
        _settings(vapid_public_key=pub, vapid_private_key="-----BEGIN EC PRIVATE KEY-----", vapid_subject="mailto:a@b.c")
    with pytest.raises(ValueError, match="VAPID_PUBLIC_KEY"):
        _settings(vapid_public_key=priv, vapid_private_key=priv, vapid_subject="mailto:a@b.c")
