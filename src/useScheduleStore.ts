import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabase';
import { Team, Agent, Company, CompanyLocation, CompanyBooking, CompanyTeam, ScheduleRow } from './types';

interface ScheduleStoreResult {
  teams: Team[];
  agents: Agent[];
  companies: Company[];
  locations: CompanyLocation[];
  bookings: CompanyBooking[];
  companyTeams: CompanyTeam[];
  scheduleRows: ScheduleRow[];
  loading: boolean;
  toggleBooking: (companyId: string, locationId: string | null, day: string, timeSlot: string) => Promise<void>;
  getCompanyTeams: (companyId: string) => Team[];
  isBooked: (companyId: string, locationId: string | null, day: string, timeSlot: string) => boolean;
  updateCompanyStatus: (companyId: string, status: string) => Promise<void>;
  addLocation: (companyId: string, label: string, state: string | null) => Promise<void>;
  removeLocation: (locationId: string) => Promise<void>;
  setCompanyTeams: (companyId: string, teamIds: string[]) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useScheduleStore(): ScheduleStoreResult {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [bookings, setBookings] = useState<CompanyBooking[]>([]);
  const [companyTeams, setCompanyTeams] = useState<CompanyTeam[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [teamsRes, agentsRes, companiesRes, locationsRes, bookingsRes, ctRes] = await Promise.all([
      supabase.from('teams').select('*'),
      supabase.from('agents').select('*'),
      supabase.from('roster_companies').select('*').order('name'),
      supabase.from('company_locations').select('*').order('sort_order'),
      supabase.from('company_bookings').select('*'),
      supabase.from('company_teams').select('*'),
    ]);

    if (teamsRes.data) setTeams(teamsRes.data);
    if (agentsRes.data) setAgents(agentsRes.data);
    if (companiesRes.data) setCompanies(companiesRes.data);
    if (locationsRes.data) setLocations(locationsRes.data);
    if (bookingsRes.data) setBookings(bookingsRes.data);
    if (ctRes.data) setCompanyTeams(ctRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('schedule-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_bookings' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_locations' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_companies' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_teams' }, () => fetchAll())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [fetchAll]);

  const getCompanyTeams = useCallback((companyId: string): Team[] => {
    const assignments = companyTeams.filter(ct => ct.company_id === companyId);
    if (assignments.length > 0) {
      return assignments
        .map(ct => teams.find(t => t.id === ct.team_id))
        .filter((t): t is Team => !!t);
    }
    const company = companies.find(c => c.id === companyId);
    if (company?.team_id) {
      const team = teams.find(t => t.id === company.team_id);
      return team ? [team] : [];
    }
    return [];
  }, [companyTeams, teams, companies]);

  const scheduleRows: ScheduleRow[] = useMemo(() => {
    const rows: ScheduleRow[] = [];
    for (const company of companies) {
      const companyLocations = locations.filter(l => l.company_id === company.id);
      if (companyLocations.length > 0) {
        for (const loc of companyLocations) {
          rows.push({
            id: `${company.id}-${loc.id}`,
            companyId: company.id,
            companyName: company.name,
            locationId: loc.id,
            locationLabel: loc.location_label,
            state: loc.state || company.state,
            teamId: company.team_id,
          });
        }
      } else {
        rows.push({
          id: company.id,
          companyId: company.id,
          companyName: company.name,
          locationId: null,
          locationLabel: null,
          state: company.state,
          teamId: company.team_id,
        });
      }
    }
    return rows;
  }, [companies, locations]);

  const toggleBooking = async (companyId: string, locationId: string | null, day: string, timeSlot: string) => {
    const existing = bookings.find(
      b => b.company_id === companyId && b.location_id === locationId && b.day === day && b.time_slot === timeSlot
    );

    if (existing) {
      setBookings(prev => prev.filter(b => b.id !== existing.id));
      const { error } = await supabase.from('company_bookings').delete().eq('id', existing.id);

      if (error) {
        console.error('Unable to clear booked slot:', error.message);
        setBookings(prev => prev.some(b => b.id === existing.id) ? prev : [...prev, existing]);
      }
    } else {
      const tempId = crypto.randomUUID();
      const newBooking: CompanyBooking = {
        id: tempId,
        company_id: companyId,
        location_id: locationId,
        day,
        time_slot: timeSlot,
        booked_by: null,
        created_at: new Date().toISOString(),
      };
      setBookings(prev => [...prev, newBooking]);
      const { data, error } = await supabase
        .from('company_bookings')
        .insert({ company_id: companyId, location_id: locationId, day, time_slot: timeSlot })
        .select()
        .maybeSingle();
      if (data) {
        setBookings(prev => prev.map(b => b.id === tempId ? data : b));
      } else {
        if (error) {
          console.error('Unable to book slot:', error.message);
          await fetchAll();
        }
        setBookings(prev => prev.filter(b => b.id !== tempId));
      }
    }
  };

  const isBooked = (companyId: string, locationId: string | null, day: string, timeSlot: string): boolean => {
    return bookings.some(
      b => b.company_id === companyId && b.location_id === locationId && b.day === day && b.time_slot === timeSlot
    );
  };

  const updateCompanyStatus = async (companyId: string, status: string) => {
    await supabase.from('roster_companies').update({ account_status: status }).eq('id', companyId);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, account_status: status } : c));
  };

  const addLocation = async (companyId: string, label: string, state: string | null) => {
    const { data } = await supabase
      .from('company_locations')
      .insert({ company_id: companyId, location_label: label, state })
      .select()
      .maybeSingle();
    if (data) setLocations(prev => [...prev, data]);
  };

  const removeLocation = async (locationId: string) => {
    await supabase.from('company_locations').delete().eq('id', locationId);
    setLocations(prev => prev.filter(l => l.id !== locationId));
    setBookings(prev => prev.filter(b => b.location_id !== locationId));
  };

  const setCompanyTeamsAction = async (companyId: string, teamIds: string[]) => {
    // Delete all existing assignments
    await supabase.from('company_teams').delete().eq('company_id', companyId);

    if (teamIds.length > 0) {
      const rows = teamIds.map(team_id => ({ company_id: companyId, team_id }));
      const { data } = await supabase.from('company_teams').insert(rows).select();
      if (data) {
        setCompanyTeams(prev => [
          ...prev.filter(ct => ct.company_id !== companyId),
          ...data,
        ]);
      }
    } else {
      setCompanyTeams(prev => prev.filter(ct => ct.company_id !== companyId));
    }

    // Also update the legacy team_id to first team or null
    const primaryTeam = teamIds[0] || null;
    await supabase.from('roster_companies').update({ team_id: primaryTeam }).eq('id', companyId);
    setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, team_id: primaryTeam } : c));
  };

  return {
    teams,
    agents,
    companies,
    locations,
    bookings,
    companyTeams,
    scheduleRows,
    loading,
    toggleBooking,
    getCompanyTeams,
    isBooked,
    updateCompanyStatus,
    addLocation,
    removeLocation,
    setCompanyTeams: setCompanyTeamsAction,
    refetch: fetchAll,
  };
}
