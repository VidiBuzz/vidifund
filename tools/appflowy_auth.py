"""Mint a GoTrue service_role/admin JWT for the local AppFlowy Cloud instance.

Used only to bootstrap access to the vidifund@gmail.com account, whose
password is not known. Run from the machine that hosts the AppFlowy Cloud
containers; reads the JWT secret out of the running gotrue container.
"""
import json
import subprocess
import sys
import time

import jwt

GOTRUE = "http://127.0.0.1:4000/gotrue"
DOCKER = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
CONTAINER = "appflowy-cloud-gotrue-1"


def container_env(name: str) -> str:
    out = subprocess.run(
        [DOCKER, "inspect", CONTAINER, "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
        capture_output=True, text=True, check=True,
    ).stdout
    for line in out.splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{name} not found in container env")


def main() -> None:
    secret = container_env("GOTRUE_JWT_SECRET")
    admin_uid = 533284792855171073  # admin@vidiflow.local, role=supabase_admin
    now = int(time.time())

    token = jwt.encode(
        {
            "sub": str(admin_uid),
            "aud": "authenticated",
            "role": "supabase_admin",
            "aal": "aal1",
            "exp": now + 3600,
            "iat": now,
            "session_id": "00000000-0000-0000-0000-000000000000",
            "is_anonymous": False,
            "app_metadata": {"provider": "email", "providers": ["email"]},
            "user_metadata": {"email": "admin@vidiflow.local", "sub": str(admin_uid)},
        },
        secret,
        algorithm="HS256",
    )
    print(token)

    # Use it to reset the target account's password.
    reset = subprocess.run(
        [
            "curl.exe", "-s", "-X", "PUT",
            f"{GOTRUE}/admin/users/2fd7ad6e-3f1b-4ac7-9aa2-248d061f808a",
            "-H", f"Authorization: Bearer {token}",
            "-H", "Content-Type: application/json",
            "-d", json.dumps({"password": "VidiFund2026!Secure"}),
        ],
        capture_output=True, text=True,
    )
    print("RESET:", reset.stdout[:400], file=sys.stderr)


if __name__ == "__main__":
    main()
