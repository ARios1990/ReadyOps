import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const db = new PGlite();
process.on("uncaughtException", (error) => {
  console.error(
    "TEST FAILURE:",
    error.message,
    error.position ? `at SQL position ${error.position}` : "",
  );
  process.exit(1);
});
let count = 0;
const test = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
  count++;
};
const scalar = async (sql) => (await db.query(sql)).rows[0]?.value;
const deny = async (sql) => {
  let rejected = false;
  try {
    await db.query(sql);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `Expected rejection: ${sql}`);
};
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asUser = async (id, role = "authenticated") => {
  await db.exec(
    `reset role;select set_config('request.jwt.claim.sub','${id || ""}',false);set role ${role};`,
  );
};
await db.exec(`create schema auth;create schema private;create schema extensions;create schema vault;create schema net;create schema cron;
create role authenticated;create role anon;create role service_role bypassrls;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.is_admin() returns boolean language sql as $$select false$$;
create function public.get_user_role() returns text language sql as $$select null::text$$;
create function public.get_user_team_id() returns uuid language sql as $$select null::uuid$$;
create function public.portal_evaluate_qualification(jsonb,jsonb) returns jsonb language sql as $$select '{"status":"qualified","reasons":[]}'::jsonb$$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
grant usage on schema public,private,auth to authenticated,anon,service_role;`);
await db.exec(
  fs.readFileSync(
    new URL("./fixtures/readyops-schema.sql", import.meta.url),
    "utf8",
  ),
);
for (const table of [
  "profiles",
  "agents",
  "teams",
  "roster_companies",
  "portal_leads",
  "portal_appointments",
  "manager_portal_links",
  "payroll_entries",
  "payroll_periods",
])
  await db.exec(
    `alter table public.${table} add primary key(id);alter table public.${table} enable row level security;`,
  );
await db.exec(`alter table public.company_portal_settings add primary key(company_id);
alter table public.payroll_periods add unique(week_start);alter table public.payroll_entries add unique(payroll_period_id,agent_id);
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;`);
for (const file of [
  "20261003230404_team_staff_and_manager_payroll.sql",
  "20261003230716_service_templates_and_lead_email_outbox.sql",
  "20261003230718_inline_agent_staff_rows.sql",
]) {
  const sql = fs
    .readFileSync(
      new URL(`../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    )
    .replace(/^create extension[^;]+;/gm, "");
  await db.exec(sql);
}
await db.exec(`
create policy admin_payroll on public.payroll_entries for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy admin_periods on public.payroll_periods for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy profile_self on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profile_self_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create trigger protect_profile before update on public.profiles for each row execute function public.prevent_profile_privilege_escalation();
create policy agents_scope on public.agents for select to authenticated using(public.is_admin() or team_id=public.current_team_id());
create policy leads_scope on public.portal_leads for select to authenticated using(private.readyops_can_view_lead(id));
create policy appointments_scope on public.portal_appointments for select to authenticated using(private.readyops_can_view_lead(lead_id));
insert into public.teams(id,name,abbreviation) values('${uid(101)}','Team A','A'),('${uid(102)}','Team B','B');
insert into public.profiles(id,display_name,role,email,team_id) values('${uid(1)}','Admin','admin','admin@example.test',null),('${uid(2)}','Manager A','manager','ma@example.test','${uid(101)}'),('${uid(3)}','Manager B','manager','mb@example.test','${uid(102)}'),('${uid(4)}','Agent A','agent','aa@example.test','${uid(101)}');
insert into public.agents(id,name,team_id,weekly_base,pay_structure) values('${uid(11)}','Agent A','${uid(101)}',450,'base_only'),('${uid(12)}','Agent B','${uid(102)}',600,'base_only');
update public.profiles set agent_id='${uid(11)}' where id='${uid(4)}';
insert into public.roster_companies(id,name,email,secondary_emails) values('${uid(21)}','Test Company','CLIENT@example.test',array['client@example.test','second@example.test']);
insert into public.company_portal_settings(company_id,public_slug,portal_enabled) values('${uid(21)}','test-company',true);
insert into public.portal_leads(id,lead_code,company_id,agent_id,agent_name,qc_status,full_name,phone_number,address,service_needed) values
('${uid(31)}','TEST-A','${uid(21)}','${uid(11)}','Agent A','approved','Test Customer','555-0100','Test Address','Roofing'),
('${uid(32)}','TEST-B','${uid(21)}','${uid(12)}','Agent B','approved','Test Customer B','555-0101','Test Address B','Roofing');
insert into public.portal_appointments(id,lead_id,company_id,appointment_date,start_time,client_status) values('${uid(41)}','${uid(31)}','${uid(21)}','2026-09-29','10:00','good'),('${uid(42)}','${uid(32)}','${uid(21)}','2026-09-29','11:00','bad');
`);
await test("manager generates only own payroll", async () => {
  await asUser(uid(2));
  const period = await scalar(
    `select public.generate_readyops_payroll_week('2026-09-29') as value`,
  );
  assert.ok(period);
  assert.equal(
    await scalar("select count(*)::int as value from public.payroll_entries"),
    1,
  );
});
await test("admin sees and generates all teams", async () => {
  await asUser(uid(1));
  await db.query(`select public.generate_readyops_payroll_week('2026-09-29')`);
  assert.equal(
    await scalar("select count(*)::int as value from public.payroll_entries"),
    2,
  );
});
await asUser(uid(1));
const entries = (
  await db.query(
    "select id,agent_id,payroll_period_id from public.payroll_entries",
  )
).rows;
const own = entries.find((e) => e.agent_id === uid(11));
const other = entries.find((e) => e.agent_id === uid(12));
await test("manager cannot read another payroll by ID or period RPC", async () => {
  await asUser(uid(2));
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.payroll_entries where id='${other.id}'`,
    ),
    0,
  );
  const rows = await scalar(
    `select public.get_readyops_payroll_entries('${own.payroll_period_id}') as value`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_name, "Agent A");
});
await test("manager cannot edit another team or inject team ID", async () => {
  await asUser(uid(2));
  await deny(
    `select public.save_readyops_team_payroll_entry('${other.id}','{"bonus":99}')`,
  );
  await deny(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"team_id":"${uid(102)}"}')`,
  );
});
await test("manager can manage own weekly payroll without changing defaults", async () => {
  await asUser(uid(2));
  await db.query(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"base_pay":500,"bonus":10,"status":"approved","notes":"Test adjustment"}')`,
  );
  assert.equal(
    Number(
      await scalar(
        `select total_pay as value from public.payroll_entries where id='${own.id}'`,
      ),
    ),
    510,
  );
  await asUser(uid(1));
  assert.equal(
    Number(
      await scalar(
        `select weekly_base as value from public.agents where id='${uid(11)}'`,
      ),
    ),
    450,
  );
});
await test("payment date required and paid entries immutable", async () => {
  await asUser(uid(2));
  await deny(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"base_pay":999,"save_defaults":true}')`,
  );
  await asUser(uid(2));
  await deny(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"status":"paid"}')`,
  );
  await db.query(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"status":"paid","payment_date":"2026-09-30"}')`,
  );
  await deny(
    `select public.save_readyops_team_payroll_entry('${own.id}','{"bonus":50}')`,
  );
});
await test("manager lead and appointment direct queries are team scoped", async () => {
  await asUser(uid(2));
  assert.equal(
    await scalar("select count(*)::int as value from public.portal_leads"),
    1,
  );
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.portal_appointments where id='${uid(42)}'`,
    ),
    0,
  );
  await deny(
    `select public.get_manager_team_overview('${uid(102)}',null,null)`,
  );
});
await test("self role/team/status escalation is blocked", async () => {
  await asUser(uid(2));
  await deny(`update public.profiles set role='admin' where id='${uid(2)}'`);
  await deny(
    `update public.profiles set team_id='${uid(102)}' where id='${uid(2)}'`,
  );
  await deny(`update public.profiles set active=false where id='${uid(2)}'`);
});
await test("staff RPC requires active admin and service-only execution", async () => {
  await asUser(uid(2));
  await deny(
    `select public.save_readyops_staff_account('${uid(2)}','${uid(4)}','${uid(11)}','Agent A','aa@example.test','agent','${uid(101)}',true,false,null)`,
  );
  await asUser(null, "service_role");
  await deny(
    `select public.save_readyops_staff_account('${uid(2)}','${uid(4)}','${uid(11)}','Agent A','aa@example.test','agent','${uid(101)}',true,false,null)`,
  );
});
await test("inactive accounts fail role checks and lose team data", async () => {
  await asUser(null, "postgres");
  await db.query(
    `update public.profiles set active=false where id='${uid(2)}'`,
  );
  await asUser(uid(2));
  assert.equal(await scalar("select public.is_admin() as value"), false);
  assert.equal(
    await scalar("select count(*)::int as value from public.portal_leads"),
    0,
  );
  assert.equal(
    await scalar("select count(*)::int as value from public.payroll_entries"),
    0,
  );
  await deny(`select public.generate_readyops_payroll_week('2026-09-29')`);
  await asUser(null, "postgres");
  await db.query(`update public.profiles set active=true where id='${uid(2)}'`);
});
await test("public config returns all scalable service defaults", async () => {
  await asUser(null, "anon");
  const rows = await scalar(
    `select public.get_public_service_templates('test-company') as value`,
  );
  assert.equal(rows.length, 7);
  assert.ok(rows.find((s) => s.id === "pdr"));
  assert.equal(
    (
      await scalar(
        `select public.get_public_service_templates('missing') as value`,
      )
    ).length,
    0,
  );
});
await test("company service qualifiers and hidden fields validated server-side", async () => {
  await asUser(null, "postgres");
  await db.query(
    `insert into public.company_service_templates(company_id,service_id,template_title,form_schema,qualification_rules) select '${uid(21)}',id,template_title,form_schema||'[{"id":"custom","title":"Qualifiers","fields":[{"key":"decision_ready","label":"Ready to decide?","type":"select","mode":"required"},{"key":"hidden_secret","label":"Hidden","type":"text","mode":"hidden"},{"key":"conditional_detail","label":"Conditional Detail","type":"text","mode":"required","showWhen":{"field":"decision_ready","equals":"Yes"}}]}]'::jsonb,'{"fields":[{"key":"decision_ready","operator":"equals","value":"Yes"}]}' from public.lead_service_templates where id='solar'`,
  );
  const payload = {
    _universal_template: true,
    service_type: "solar",
    full_name: "Test",
    phone_number: "555",
    address: "Test",
    service_needed: "Solar",
    decision_ready: "No",
    hidden_secret: "must drop",
    conditional_detail: "also drop",
  };
  await db.query(
    "insert into public.portal_leads(id,company_id,agent_id,form_data) values($1,$2,$3,$4)",
    [uid(33), uid(21), uid(11), JSON.stringify(payload)],
  );
  const row = (
    await db.query(`select * from public.portal_leads where id='${uid(33)}'`)
  ).rows[0];
  assert.equal(row.service_type, "solar");
  assert.equal(row.qualification_status, "do_not_book");
  assert.equal(row.form_data.hidden_secret, undefined);
  assert.equal(row.form_data.conditional_detail, undefined);
  assert.ok(!row.form_data.lead_template.includes("Conditional Detail"));
  assert.equal(
    row.form_data._service_template.template_title,
    "Solar Appointment",
  );
  await deny(
    `insert into public.portal_leads(company_id,form_data) values('${uid(21)}','{"_universal_template":true,"service_type":"solar","full_name":"Test","phone_number":"555","address":"Test","service_needed":"Solar"}')`,
  );
});
await test("automatic release deduplicates and uses profile email list", async () => {
  await asUser(null, "postgres");
  await db.query(
    `update public.portal_appointments set company_visible_at=now() where id='${uid(41)}'`,
  );
  await db.query(
    `update public.portal_appointments set company_visible_at=now() where id='${uid(41)}'`,
  );
  await db.query(
    `update public.portal_appointments set company_visible_at=null where id='${uid(41)}'`,
  );
  await db.query(
    `update public.portal_appointments set company_visible_at=now() where id='${uid(41)}'`,
  );
  assert.equal(
    await scalar(
      "select count(*)::int as value from public.lead_email_notifications",
    ),
    1,
  );
  assert.deepEqual(
    (
      await scalar(
        "select recipients as value from public.lead_email_notifications",
      )
    ).sort(),
    ["client@example.test", "second@example.test"],
  );
});
await test("email worker claiming prevents concurrent duplicates", async () => {
  await asUser(null, "service_role");
  const jobs = await scalar(
    "select public.claim_readyops_lead_emails(10) as value",
  );
  assert.equal(jobs.length, 1);
  assert.equal(
    (await scalar("select public.claim_readyops_lead_emails(10) as value"))
      .length,
    0,
  );
  await db.query(
    `select public.finish_readyops_lead_email('${jobs[0].id}','${jobs[0].claim_token}','provider-test',null,false)`,
  );
  assert.equal(
    (await scalar("select public.claim_readyops_lead_emails(10) as value"))
      .length,
    0,
  );
});
await test("manager email history/resend cannot cross teams", async () => {
  await asUser(uid(3));
  assert.equal(
    await scalar(
      "select count(*)::int as value from public.lead_email_notifications",
    ),
    0,
  );
  await deny(
    `select public.request_lead_email_resend('${uid(31)}','${uid(501)}')`,
  );
  await asUser(uid(2));
  assert.equal(
    await scalar(
      "select count(*)::int as value from public.lead_email_notifications",
    ),
    1,
  );
  await asUser(null, "postgres");
  await db.query(
    "update public.lead_email_notifications set created_at=now()-interval '2 minutes'",
  );
  await asUser(uid(2));
  const id = await scalar(
    `select public.request_lead_email_resend('${uid(31)}','${uid(502)}') as value`,
  );
  assert.ok(id);
  assert.equal(
    await scalar(
      `select public.request_lead_email_resend('${uid(31)}','${uid(502)}') as value`,
    ),
    id,
  );
});
const loadTs = (path) => {
  const code = ts.transpileModule(
    fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", code)(
    module.exports,
    () => {},
    module,
  );
  return module.exports;
};
await test("remaining and payment are always finite numeric values", async () => {
  const m = loadTs("../src/companyMetrics.ts");
  assert.equal(m.packageRemaining({}), 0);
  assert.equal(m.formatCompanyPayment({}), "$0.00");
  assert.equal(
    m.packageRemaining({
      package: { pending_leads: null, lead_target: 20, delivered_leads: 7 },
    }),
    13,
  );
  assert.equal(m.packageRemaining({ package: { pending_leads: -5 } }), 0);
  assert.equal(
    m.formatCompanyPayment({ package: { amount_paid: "1250.5" } }),
    "$1,250.50",
  );
  assert.equal(
    m.formatCompanyPayment({ package: { amount_paid: "NaN" } }),
    "$0.00",
  );
});
await test("legacy manager links require sign-in, exact team and never expose agent tokens", async () => {
  await asUser(null, "postgres");
  await db.query(
    `insert into public.manager_portal_links(id,name,team_id,access_token) values('${uid(601)}','Team B Link','${uid(102)}','${uid(602)}')`,
  );
  await asUser(null, "anon");
  await deny(
    `select public.get_manager_link_overview('${uid(602)}',null,null)`,
  );
  await asUser(uid(2));
  await deny(
    `select public.get_manager_link_overview('${uid(602)}',null,null)`,
  );
  await deny(`select public.regenerate_agent_portal_link('${uid(11)}')`);
  const overview = await scalar(
    `select public.get_manager_team_overview(null,null,null) as value`,
  );
  assert.ok(overview.agents.length);
  assert.ok(overview.agents.every((a) => a.access_token == null));
  await asUser(uid(3));
  const ownOverview = await scalar(
    `select public.get_manager_link_overview('${uid(602)}',null,null) as value`,
  );
  assert.equal(ownOverview.team.id, uid(102));
});
await test("staff save synchronizes profile/agent, rotates old team token and prevents self-lockout", async () => {
  await asUser(null, "postgres");
  const oldToken = await scalar(
    `select access_token as value from public.agents where id='${uid(11)}'`,
  );
  await asUser(null, "service_role");
  const previous = await scalar(
    `select public.save_readyops_staff_account('${uid(1)}','${uid(4)}','${uid(11)}','Agent A Edited','edited@example.test','agent','${uid(102)}',false,false,null) as value`,
  );
  await db.query(
    `select public.save_readyops_staff_account('${uid(1)}','${uid(4)}','${uid(11)}','Agent A Edited','edited@example.test','agent','${uid(102)}',false,true,'${previous.updated_at}')`,
  );
  await deny(
    `select public.save_readyops_staff_account('${uid(1)}','${uid(1)}',null,'Admin','admin@example.test','agent','${uid(101)}',true,false,null)`,
  );
  await deny(
    `select public.save_readyops_staff_account('${uid(1)}','${uid(1)}',null,'Admin','admin@example.test','admin',null,false,false,null)`,
  );
  await asUser(null, "postgres");
  const edited = (
    await db.query(
      `select p.display_name,p.email,p.active,p.team_id,a.name,a.access_token,a.email as agent_email,a.active as agent_active from public.profiles p join public.agents a on a.id=p.agent_id where p.id='${uid(4)}'`,
    )
  ).rows[0];
  assert.equal(edited.display_name, "Agent A Edited");
  assert.equal(edited.email, edited.agent_email);
  assert.equal(edited.name, edited.display_name);
  assert.equal(edited.team_id, uid(102));
  assert.equal(edited.active, false);
  assert.equal(edited.agent_active, false);
  assert.notEqual(edited.access_token, oldToken);
  await asUser(uid(2));
  await deny(
    `select public.request_lead_email_resend('${uid(31)}','${uid(503)}')`,
  );
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.payroll_entries where id='${own.id}'`,
    ),
    0,
  );
  await asUser(null, "postgres");
  await deny(`update public.management_audit_events set event_type='tampered'`);
});
await test("client release queues universal email once and never queues old same-day batches", async () => {
  await asUser(null, "postgres");
  await db.exec(`create function public.portal_active_package(uuid) returns uuid language sql as $$select null::uuid$$;
  create function public.portal_complete_package_if_filled(uuid) returns void language sql as $$select$$;
  create function public.portal_actor_name_for_management() returns text language sql as $$select 'Test Admin'$$;
  create function public.portal_write_audit(uuid,text,uuid,text,text,text,uuid,jsonb,jsonb,jsonb) returns void language sql as $$select$$;
  insert into public.portal_leads(id,company_id,agent_id,lead_code,qc_status,full_name,phone_number,address,service_needed) values('${uid(71)}','${uid(21)}','${uid(12)}','TEST-SEND','approved','Send Test','555','Address','Roofing');
  insert into public.portal_appointments(id,lead_id,company_id,appointment_date,start_time) values('${uid(72)}','${uid(71)}','${uid(21)}',current_date,'10:00');
  insert into public.qc_review_cycles(id,lead_id,appointment_id,company_id,status,is_current) values('${uid(73)}','${uid(71)}','${uid(72)}','${uid(21)}','approved',true);`);
  await asUser(uid(3));
  await deny(`select public.qc_send_lead_to_client('${uid(71)}')`);
  await asUser(uid(1));
  const sent = await scalar(
    `select public.qc_send_lead_to_client('${uid(71)}') as value`,
  );
  assert.equal(sent.lead_email_notification_queued, true);
  assert.equal(sent.same_day_notification_queued, false);
  const again = await scalar(
    `select public.qc_send_lead_to_client('${uid(71)}') as value`,
  );
  assert.equal(again.already_sent, true);
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.lead_email_notifications where lead_id='${uid(71)}'`,
    ),
    1,
  );
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.company_notification_batches`,
    ),
    0,
  );
});
await test("switching services clears old qualifiers without losing contact data", async () => {
  const m = loadTs("../src/serviceTemplates.ts");
  for (const [name, expected] of [
    ["Residential Roofing", "roofing"],
    ["Street Address", "roofing"],
    ["Home Improvement", "home_improvement"],
    ["Permanent Exterior Lighting", "permanent_exterior_lighting"],
    ["Tree Service", "tree_service"],
    ["Paintless Dent Repair", "pdr"],
  ]) {
    assert.equal(m.inferServiceType(name), expected);
    await asUser(null, "postgres");
    assert.equal(
      await scalar(`select private.readyops_infer_service('${name}') as value`),
      expected,
    );
  }
  const roof = m.DEFAULT_SERVICE_TEMPLATES.find((s) => s.id === "roofing");
  const lighting = m.DEFAULT_SERVICE_TEMPLATES.find(
    (s) => s.id === "permanent_exterior_lighting",
  );
  const values = m.switchServiceValues(
    {
      full_name: "Test",
      phone_number: "555",
      roof_age: "20",
      insurance_name: "X",
      notes: "Keep",
    },
    roof,
    lighting,
  );
  assert.equal(values.roof_age, undefined);
  assert.equal(values.insurance_name, undefined);
  assert.equal(values.full_name, "Test");
  assert.equal(values.service_type, lighting.id);
  const text = m.buildUniversalLeadTemplate(lighting, values);
  assert.ok(text.includes("Exterior Lighting Appointment"));
  assert.ok(!text.includes("Roof Age:"));
});
await test("email HTML escapes customer text and never includes QC recordings", async () => {
  const m = loadTs("../supabase/functions/send-lead-emails/template.ts");
  const email = m.renderLeadEmail({
    customer_name: "<script>alert(1)</script>",
    phone_number: "555",
    notes: "A & B",
    form_data: { recording_url: "private-audio" },
    service_template: {
      form_schema: [
        {
          fields: [
            { key: "recording_url", label: "Recording", type: "recording" },
          ],
        },
      ],
    },
  });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.ok(!email.text.includes("private-audio"));
  assert.ok(!email.html.includes("private-audio"));
});
await asUser(null, "postgres");
await db.exec(`insert into public.agents(id,name,team_id) values('${uid(711)}','Inline A','${uid(101)}'),('${uid(712)}','Inline B','${uid(101)}'),('${uid(713)}','Inline C','${uid(101)}');
insert into public.profiles(id,display_name,role,email,team_id,agent_id,active) values
('${uid(721)}','Login A','agent','login-a@example.test','${uid(101)}','${uid(711)}',true),
('${uid(722)}','Login New','agent','new@example.test','${uid(102)}',null,false),
('${uid(723)}','Login B','agent','login-b@example.test','${uid(101)}','${uid(712)}',true),
('${uid(724)}','Manager Login','manager','manager-inline@example.test','${uid(101)}',null,true);`);
const rowExpected = async (agent, target) => {
  await asUser(null, "postgres");
  return scalar(
    `select jsonb_build_object('name',a.name,'team_id',a.team_id,'active',coalesce(a.active,true),'profile_id',p.id,'profile_updated_at',p.updated_at,'target_updated_at',t.updated_at) as value from public.agents a left join public.profiles p on p.agent_id=a.id left join public.profiles t on t.id='${target || uid(0)}' where a.id='${agent}'`,
  );
};
const saveRow = async (
  agent,
  target,
  expected,
  {
    actor = uid(1),
    name = "Inline Edited",
    team = uid(101),
    active = true,
    apply = true,
  } = {},
) =>
  scalar(
    `select public.save_readyops_agent_row('${actor}','${agent}','${name}','${team}',${active},${target ? `'${target}'` : "null"},'${JSON.stringify(expected)}',${apply}) as value`,
  );
await test("inline row RPC is service-only and requires an active Admin actor", async () => {
  const expected = await rowExpected(uid(711), uid(721));
  await asUser(uid(2));
  await assert.rejects(() => saveRow(uid(711), uid(721), expected));
  await asUser(null, "anon");
  await assert.rejects(() => saveRow(uid(711), uid(721), expected));
  await asUser(null, "service_role");
  await assert.rejects(() =>
    saveRow(uid(711), uid(721), expected, { actor: uid(2) }),
  );
});
await test("inline row saves independent name, team and account status together and rotates the token", async () => {
  const expected = await rowExpected(uid(711), uid(721));
  const oldToken = await scalar(
    `select access_token as value from public.agents where id='${uid(711)}'`,
  );
  await asUser(null, "service_role");
  await saveRow(uid(711), uid(721), expected, {
    team: uid(102),
    active: false,
  });
  await asUser(null, "postgres");
  const a = (
    await db.query(`select * from public.agents where id='${uid(711)}'`)
  ).rows[0];
  const p = (
    await db.query(`select * from public.profiles where id='${uid(721)}'`)
  ).rows[0];
  assert.equal(a.name, "Inline Edited");
  assert.equal(p.display_name, "Login A");
  assert.equal(a.team_id, uid(102));
  assert.equal(p.team_id, a.team_id);
  assert.equal(p.role, "agent");
  assert.equal(a.active, false);
  assert.equal(p.active, false);
  assert.notEqual(a.access_token, oldToken);
  assert.equal(
    await scalar(
      `select count(*)::int as value from public.management_audit_events where target_id='${uid(711)}' and event_type='agent_row_updated'`,
    ),
    1,
  );
});
await test("inline row replaces the link atomically and disables the displaced login", async () => {
  const expected = await rowExpected(uid(711), uid(722));
  await asUser(null, "service_role");
  const plan = await saveRow(uid(711), uid(722), expected, { apply: false });
  assert.equal(plan.link_changed, true);
  assert.equal(plan.profile_changes.length, 2);
  await saveRow(uid(711), uid(722), expected);
  await asUser(null, "postgres");
  assert.equal(
    await scalar(
      `select agent_id as value from public.profiles where id='${uid(721)}'`,
    ),
    null,
  );
  assert.equal(
    await scalar(
      `select active as value from public.profiles where id='${uid(721)}'`,
    ),
    false,
  );
  assert.equal(
    await scalar(
      `select agent_id as value from public.profiles where id='${uid(722)}'`,
    ),
    uid(711),
  );
  await asUser(uid(721));
  assert.equal(
    await scalar(`select public.current_profile_role() as value`),
    "inactive",
  );
});
await test("inline row cannot steal another agent login, attach a Manager or overwrite a stale row", async () => {
  for (const target of [uid(723), uid(724)]) {
    const expected = await rowExpected(uid(711), target);
    await asUser(null, "service_role");
    await assert.rejects(() => saveRow(uid(711), target, expected));
  }
  const expected = await rowExpected(uid(711), uid(722));
  await db.query(
    `update public.agents set name='Changed elsewhere' where id='${uid(711)}'`,
  );
  await asUser(null, "service_role");
  await assert.rejects(() => saveRow(uid(711), uid(722), expected));
});
await test("two pending row edits cannot link the same user to different agents", async () => {
  const expectedA = await rowExpected(uid(711), null);
  await asUser(null, "service_role");
  await saveRow(uid(711), null, expectedA);
  const first = await rowExpected(uid(711), uid(722));
  const second = await rowExpected(uid(713), uid(722));
  await asUser(null, "service_role");
  await saveRow(uid(711), uid(722), first);
  await assert.rejects(() => saveRow(uid(713), uid(722), second));
  await asUser(null, "postgres");
  assert.equal(
    await scalar(
      `select agent_id as value from public.profiles where id='${uid(722)}'`,
    ),
    uid(711),
  );
  assert.equal(
    await scalar(
      `select name as value from public.agents where id='${uid(713)}'`,
    ),
    "Inline C",
  );
});
await db.close();
console.log(
  `${count} tests passed. No production records or external emails were used.`,
);
