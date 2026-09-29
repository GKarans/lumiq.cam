import {createHash} from 'node:crypto';

export function extractFunctionOwnerTransfers(sql){
 const transfers=[];
 const schemaCreateRevokes=[];
 const pattern=/\balter\s+function\s+(public\.[a-z_][a-z0-9_]*\([^;]*?\))\s+owner\s+to\s+([a-z_][a-z0-9_]*)\s*;/gi;
 let migrationSql=sql.replace(pattern,(_,signature,role)=>{transfers.push({signature,role});return '';});
 migrationSql=migrationSql.replace(/\brevoke\s+create\s+on\s+schema\s+public\s+from\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)\s*;/gi,(_,roles)=>{
  schemaCreateRevokes.push(...roles.split(',').map(role=>role.trim()));
  return '';
 });
 return {migrationSql,transfers,schemaCreateRevokes};
}

// Add new numbered entries; never edit a migration already applied to staging.
export async function migrate(db,entries,{local=false}={}){
 await db.query('create table if not exists platform_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())');
 await db.query('alter table platform_migrations enable row level security');
 await db.query("do $$ begin if exists(select 1 from pg_roles where rolname='anon') then revoke all on platform_migrations from anon; end if; if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on platform_migrations from authenticated; end if; end $$;");
 for(const entry of entries){
  const checksum=createHash('sha256').update(entry.sql.replaceAll('\r\n','\n')).digest('hex');
  await db.transaction(async tx=>{
   await tx.query('lock table platform_migrations in exclusive mode');
   const prior=(await tx.query('select checksum from platform_migrations where version=$1',[entry.version])).rows[0];
   if(prior?.checksum===checksum)return;
   if(prior&&!local)throw new Error(`Migration ${entry.version} changed after application. Add a new forward migration.`);
   const {migrationSql:sourceSql,transfers,schemaCreateRevokes}=extractFunctionOwnerTransfers(entry.sql);
   const roleRequirement=sourceSql.match(/^\s*-- lumiq:requires-role ([a-z_][a-z0-9_]*)\s*$/m);
   let migrationSql=sourceSql;
   if(roleRequirement){
    const exists=(await tx.query('select exists(select 1 from pg_roles where rolname=$1) as present',[roleRequirement[1]])).rows[0]?.present;
    if(!exists)migrationSql=sourceSql.slice(0,roleRequirement.index);
   }
   await tx.exec(migrationSql);
   const transferredRoles=new Set();
   for(const {signature,role} of transfers){
    const present=(await tx.query('select to_regprocedure($1) is not null as function_exists,exists(select 1 from pg_roles where rolname=$2) as role_exists',[signature,role])).rows[0];
    if(present.function_exists&&present.role_exists){
     await tx.exec(`grant create on schema public to ${role}`);
     await tx.exec(`alter function ${signature} owner to ${role}`);
     transferredRoles.add(role);
    }
   }
   for(const role of new Set([...schemaCreateRevokes,...transferredRoles])){
    const exists=(await tx.query('select exists(select 1 from pg_roles where rolname=$1) as present',[role])).rows[0]?.present;
    if(exists)await tx.exec(`revoke create on schema public from ${role}`);
   }
   await tx.query('insert into platform_migrations(version,checksum) values($1,$2) on conflict(version) do update set checksum=excluded.checksum,applied_at=now()',[entry.version,checksum]);
  });
 }
}
