"""Prototype role names and policy placeholders.

Do not treat a client-supplied role as authentication. Replace this module with
real authentication and server-side role checks before handling real documents.
"""

ROLES = {"submitter", "reviewer", "approver", "admin"}


def can_make_decision(role: str) -> bool:
    return role in {"approver", "admin"}
