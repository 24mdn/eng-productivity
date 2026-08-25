"""
service-role key, bypasses RLS entirely. Used only by ingest.py/seed_users.py, which run
outside any user session — never use this to serve a user-facing read.

The read path (previously served by this API via a token-scoped client) now lives in the
Next.js app (lib/metrics-repository.ts, lib/supabase/rls-client.ts) — see git history.
"""

from __future__ import annotations

from supabase import Client, create_client

from app.config import settings


def get_service_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
