"""
Run once: python -m app.seed_users

Creates the demo accounts (1 exec + 1 engineer per squad). auth.users is GoTrue-managed, not a
plain-insertable table, so user creation goes through the Admin API — an explicit two-step
(admin.create_user, then a service-role insert into public.users for role+squad_id) rather than
a Postgres trigger reading user_metadata, which is more moving parts than 4 rows justify.
"""

from __future__ import annotations

from supabase import Client

from app.squads import get_squads
from app.supabase_client import get_service_client

DEMO_PASSWORD = "change-me-now-123!"  # dev/demo only — rotate before sharing any real link


def _create_user(client: Client, email: str, role: str, squad_id: str | None) -> None:
    auth_result = client.auth.admin.create_user(
        {"email": email, "password": DEMO_PASSWORD, "email_confirm": True}
    )
    user_id = auth_result.user.id
    client.table("users").insert(
        {"id": user_id, "email": email, "role": role, "squad_id": squad_id}
    ).execute()
    print(f"created {role:9s} {email:35s} squad={squad_id}")


def main() -> None:
    client = get_service_client()

    # squad_id is nullable on public.users precisely for this — exec's RLS policy never checks
    # it, so a real NULL is correct rather than assigning the exec account to an arbitrary real
    # squad (see supabase/migrations/20260807160000_squads_and_metric_records.sql).
    _create_user(client, "exec@mal-demo.local", "exec", squad_id=None)

    for squad in get_squads():
        _create_user(client, f"engineer-{squad.id}@mal-demo.local", "engineer", squad.id)

    print(f"\nAll accounts use password: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
