"""Prototype role handling.

X-User / X-Role headers are NOT real authentication. Replace this module with
real login (JWT/session) before handling real documents. The permission checks
that use it still run on the server.
"""

from fastapi import Header, HTTPException

ROLES = {"submitter", "reviewer", "approver", "admin"}
DECIDERS = {"reviewer", "approver", "admin"}


def get_actor(
    x_user: str = Header(default="demo-user"),
    x_role: str = Header(default="submitter"),
) -> tuple[str, str]:
    role = x_role.strip().lower()
    if role not in ROLES:
        raise HTTPException(status_code=403, detail="Unknown role")
    return (x_user.strip() or "demo-user"), role


def can_make_decision(role: str) -> bool:
    return role in DECIDERS