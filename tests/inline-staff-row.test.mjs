import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const code = ts.transpileModule(
    fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", code)(
    module.exports,
    (id) => (id in overrides ? overrides[id] : require(id)),
    module,
  );
  return module.exports;
}
const model = load("../src/staffRowModel.ts");
const agent = { id: "a1", name: "Test Agent", team_id: "t1", active: true };
const profiles = [
  {
    id: "p1",
    display_name: "Test Login",
    role: "agent",
    agent_id: "a1",
    team_id: "t1",
    email: "login@example.test",
    active: true,
    updated_at: "2026-10-03T10:00:00Z",
  },
  {
    id: "p2",
    display_name: "New Login",
    role: "agent",
    agent_id: null,
    active: true,
  },
  {
    id: "p3",
    display_name: "Other Linked Login",
    role: "agent",
    agent_id: "a2",
    active: true,
  },
  {
    id: "p4",
    display_name: "Manager Login",
    role: "manager",
    agent_id: null,
    active: true,
  },
];
const teams = [
  { id: "t1", name: "Team One", abbreviation: "ONE" },
  { id: "t2", name: "Team Two", abbreviation: "TWO" },
];
const calls = [];
let response = { data: { success: true }, error: null };
let refreshes = 0;
let refreshFail = false;
const { InlineAgentRow } = load("../src/InlineAgentRow.tsx", {
  "./staffRowModel": model,
  "./supabase": {
    supabase: {
      functions: {
        invoke: async (name, args) => {
          calls.push({ name, ...args });
          return response;
        },
      },
    },
  },
});
let renderer;
const button = (label) => renderer.root.findByProps({ "aria-label": label });
const click = async (label) =>
  act(async () => {
    button(label).props.onClick();
  });
const change = async (label, value) =>
  act(async () => {
    button(label).props.onChange({ target: { value } });
  });
await act(async () => {
  renderer = TestRenderer.create(
    React.createElement(
      "table",
      null,
      React.createElement(
        "tbody",
        null,
        React.createElement(InlineAgentRow, {
          agent,
          profiles,
          teams,
          onAccountSettings: () => {},
          onSaved: async () => {
            refreshes++;
            if (refreshFail) throw new Error("Refresh failed");
          },
        }),
      ),
    ),
  );
});
assert.deepEqual(
  model.linkableAgentProfiles(agent, profiles).map((p) => p.id),
  ["p1", "p2"],
);
await click("Edit team for Test Agent");
for (const label of ["Agent name", "Team", "Linked user", "Status"])
  assert.ok(button(`${label} for Test Agent`));
await change("Agent name for Test Agent", "Unsaved");
await click("Cancel editing Test Agent");
assert.equal(calls.length, 0);
assert.equal(
  button("Edit agent name for Test Agent").props.children[0],
  "Test Agent",
);
console.log(
  "PASS clicking a marked cell opens all four inline fields; Cancel never writes",
);
await click("Edit row for Test Agent");
await change("Agent name for Test Agent", "Renamed Agent");
await change("Team for Test Agent", "t2");
await change("Linked user for Test Agent", "p2");
await change("Status for Test Agent", "inactive");
await click("Save Test Agent");
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "update-staff");
assert.equal(calls[0].body.name, "Renamed Agent");
assert.equal(calls[0].body.team_id, "t2");
assert.equal(calls[0].body.linked_profile_id, "p2");
assert.equal(calls[0].body.active, false);
assert.equal(calls[0].body.expected.name, "Test Agent");
assert.equal(refreshes, 1);
console.log(
  "PASS inline Save submits all changed values and refreshes the dashboard",
);
response = { data: null, error: { message: "Denied by server" } };
await click("Edit status for Test Agent");
await change("Status for Test Agent", "inactive");
await click("Save Test Agent");
assert.ok(button("Status for Test Agent"));
assert.equal(
  renderer.root.findByProps({ role: "alert" }).props.children,
  "Denied by server",
);
console.log(
  "PASS failed saves keep the draft editable and show the server error",
);
await click("Cancel editing Test Agent");
response = { data: { success: true }, error: null };
refreshFail = true;
await click("Edit agent name for Test Agent");
await click("Save Test Agent");
assert.ok(
  renderer.root
    .findByProps({ role: "status" })
    .props.children.includes("Changes were saved"),
);
assert.equal(
  renderer.root.findAllByProps({ "aria-label": "Save Test Agent" }).length,
  0,
);
console.log(
  "PASS a refresh failure is not misreported as a failed database save",
);
await act(async () => renderer.unmount());
console.log("4 inline UI tests passed. No production accounts were changed.");
