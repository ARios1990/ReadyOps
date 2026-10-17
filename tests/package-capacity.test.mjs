import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE portal_leads(id uuid,company_id uuid,package_id uuid,qc_status text);
CREATE TABLE qc_review_cycles(lead_id uuid,is_current boolean,status text);
CREATE TABLE portal_appointments(id uuid,lead_id uuid,company_id uuid,created_at timestamptz,company_visible_at timestamptz,status text,canonical_status text,client_status text,company_action text,sales_outcome text);`);
const migration = fs.readFileSync(new URL('../supabase/migrations/20261017040220_package_counts_good_and_signed_only.sql', import.meta.url),'utf8');
await db.exec(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.readyops_delivered_lead_count'),migration.indexOf('-- Preserve')));
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const pkg=uuid(1),company=uuid(2),lead=uuid(3);
await db.query('INSERT INTO portal_leads VALUES ($1,$2,$3,\'approved\')',[lead,company,pkg]);
await db.query(`INSERT INTO portal_appointments VALUES ($1,$2,$3,'2026-01-01',now(),'confirmed','pending','pending','pending',null)`,[uuid(4),lead,company]);
const count=async()=> (await db.query('SELECT readyops_delivered_lead_count($1) n',[pkg])).rows[0].n;
for(const s of ['pending','confirmed','bad','no_show','rescheduled','qc_denied']){
  await db.query('UPDATE portal_appointments SET canonical_status=$1,client_status=\'good\'',[s]);
  assert.equal(await count(),0,`Exclude ${s}, even with stale good field`);
}
for(const s of ['good_inspected','Good','signed_contract','Signed Deal','signed_claim_filed']){
  await db.query('UPDATE portal_appointments SET canonical_status=$1',[s]);assert.equal(await count(),1,s);
}
await db.query(`INSERT INTO portal_appointments VALUES ($1,$2,$3,'2026-02-01',now(),'confirmed','pending','pending','pending',null)`,[uuid(5),lead,company]);
assert.equal(await count(),0,'Latest appointment supersedes old success');
await db.exec("UPDATE portal_appointments SET canonical_status='good_inspected'");assert.equal(await count(),1,'Count lead once');
await db.query("INSERT INTO qc_review_cycles VALUES ($1,true,'denied')",[lead]);assert.equal(await count(),0,'Current denied QC overrides legacy approved');
await db.exec("UPDATE qc_review_cycles SET status='approved'; UPDATE portal_appointments SET company_visible_at=null");assert.equal(await count(),0,'Unreleased excluded');
await db.exec("UPDATE portal_appointments SET company_visible_at=now(),status='cancelled'");assert.equal(await count(),0,'Cancelled excluded');
await db.close();
console.log('PASS package status eligibility, latest appointment, unique leads, QC denial, visibility and cancellation');
