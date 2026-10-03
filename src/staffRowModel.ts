import type { Agent, Profile } from "./types";

export type AgentRowDraft = {
  name: string;
  teamId: string;
  profileId: string;
  active: boolean;
};
export function linkedAgentProfile(agent: Agent, profiles: Profile[]) {
  return profiles.find((profile) => profile.agent_id === agent.id);
}
export function agentRowDraft(agent: Agent, profile?: Profile): AgentRowDraft {
  return {
    name: agent.name,
    teamId: agent.team_id || "",
    profileId: profile?.id || "",
    active: agent.active !== false && profile?.active !== false,
  };
}
export function linkableAgentProfiles(agent: Agent, profiles: Profile[]) {
  return profiles.filter(
    (profile) =>
      profile.agent_id === agent.id ||
      (profile.role === "agent" && !profile.agent_id),
  );
}
export function agentRowRequest(
  agent: Agent,
  profiles: Profile[],
  draft: AgentRowDraft,
) {
  const current = linkedAgentProfile(agent, profiles);
  const target = profiles.find((profile) => profile.id === draft.profileId);
  return {
    mode: "agent_row",
    agent_id: agent.id,
    name: draft.name.trim(),
    team_id: draft.teamId,
    linked_profile_id: draft.profileId || null,
    active: draft.active,
    expected: {
      name: agent.name,
      team_id: agent.team_id || null,
      active: agent.active !== false,
      profile_id: current?.id || null,
      profile_updated_at: current?.updated_at || null,
      target_updated_at: target?.updated_at || null,
    },
  };
}
