import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const lead='00000000-0000-4000-8000-000000000011',company='00000000-0000-4000-8000-000000000012';
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table draft_save_fixture(id uuid primary key,name text);
 insert into draft_save_fixture values('${lead}','Before');
 create function public.qc_update_lead(p_id uuid,p_patch jsonb) returns jsonb language plpgsql as $$begin
 if current_setting('test.access',true) is distinct from 'yes' then raise exception 'reviewer required';end if;
 update public.draft_save_fixture set name=p_patch->>'name' where id=p_id;
 return jsonb_build_object('id',p_id,'company_id','${company}','full_name',p_patch->>'name');end $$;
 create function public.qc_move_lead(uuid,uuid,uuid,date,text,text) returns jsonb language plpgsql as $$begin
 if current_setting('test.owner',true) is distinct from 'yes' then raise exception 'owner required';end if;
 if $5='00:00' then raise exception 'capacity rejected';end if;
 return jsonb_build_object('lead',jsonb_build_object('id',$1,'full_name',(select name from public.draft_save_fixture where id=$1)),'appointment',jsonb_build_object('appointment_date',$4,'start_time',$5,'status','qc_pending'));end $$;`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261028000735_qc_recording_verified_draft_save.sql',import.meta.url),'utf8'));
const scalar=async sql=>(await db.query(sql)).rows[0].v;
await assert.rejects(()=>scalar(`select qc_save_verified_edits('${lead}','{"name":"unauthorized"}') v`));
await db.exec("select set_config('test.access','yes',false)");
assert.equal((await scalar(`select qc_save_verified_edits('${lead}','{"name":"Saved fields"}') v`)).lead.full_name,'Saved fields');
await assert.rejects(()=>scalar(`select qc_save_verified_edits('${lead}','{"name":"Must roll back"}','2026-10-31','11:00') v`));
assert.equal(await scalar('select name v from draft_save_fixture'),'Saved fields','Owner rejection rolls back the field write');
await db.exec("select set_config('test.owner','yes',false)");
await assert.rejects(()=>scalar(`select qc_save_verified_edits('${lead}','{"name":"Must also roll back"}','2026-10-31','00:00') v`));
assert.equal(await scalar('select name v from draft_save_fixture'),'Saved fields','Capacity rejection rolls back the field write');
const result=await scalar(`select qc_save_verified_edits('${lead}','{"name":"Reviewed correction"}','2026-10-31','11:00') v`);
assert.equal(result.appointment.start_time,'11:00');assert.equal(result.appointment.status,'qc_pending');
await assert.rejects(()=>scalar(`select qc_save_verified_edits('${lead}','{}','2026-10-31',null) v`));
for(const role of ['anon','service_role']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query(`select qc_save_verified_edits('${lead}','{}')`));await db.exec('reset role');}
await db.close();console.log('PASS reviewer/owner authorization delegation, atomic save rollback, scheduling validation and no automatic approval');
