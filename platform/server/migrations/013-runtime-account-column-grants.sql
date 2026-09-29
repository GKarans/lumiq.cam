do $$ begin
 if exists(select 1 from pg_roles where rolname='lumiq_runtime') then
  revoke insert, update, delete on table public.accounts from lumiq_runtime;
  grant insert (id,email,name,password_hash,profile,preferences,verified)
   on table public.accounts to lumiq_runtime;
  grant update (email,name,password_hash,profile,preferences,verified,storage_prefix,design_defaults)
   on table public.accounts to lumiq_runtime;
 end if;
end $$;
