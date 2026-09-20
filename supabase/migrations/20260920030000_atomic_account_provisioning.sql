-- Publish a new account only after its initial subscription (and any existing
-- gift trigger) has committed. Edge-level rollback deletes are unsafe once a
-- concurrent sign-in can observe the account row.
begin;
create or replace function public.create_app_account(
  p_email text,
  p_password_hash text,
  p_display_name text,
  p_product_slug text
)
returns table(id uuid, email text, display_name text, created_at timestamptz, session_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users%rowtype;
begin
  if p_email is null or p_email <> lower(btrim(p_email)) or length(p_email) > 320
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_password_hash is null
     or not (p_password_hash ~ '^[0-9a-f]{32}:[0-9a-f]{64}$' or p_password_hash ~ '^oauth:[a-zA-Z0-9_-]{1,80}$')
     or p_product_slug is null or p_product_slug not in ('war_room', 'dynast_hq', 'bundle', 'dhq') then
    raise exception 'Invalid account provisioning arguments' using errcode = '22023';
  end if;

  -- A duplicate email is an ordinary conflict. Never update or delete the
  -- existing account; OAuth may resume the winner after it commits.
  insert into public.app_users(email, password_hash, display_name)
  values (p_email, p_password_hash, left(coalesce(p_display_name, split_part(p_email, '@', 1)), 120))
  returning * into v_user;

  insert into public.subscriptions(user_id, product_slug, tier, status)
  values (v_user.id, p_product_slug, 'free', 'active');

  return query select v_user.id, v_user.email, v_user.display_name, v_user.created_at, v_user.session_version;
end;
$$;
revoke all on function public.create_app_account(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_app_account(text, text, text, text) to service_role;
commit;
