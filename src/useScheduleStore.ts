import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabase';
import { Team, Agent, Company, CompanyLocation, CompanyLocationAgent, CompanyBooking, CompanyTeam, CompanyScheduleException, PortalAppointment, ScheduleRow, DAYS } from './types';
import { addDays, localDate, startOfWeek } from './portalUtils';

type PortalReservation = {
  id: string;
  company_id: string;
  location_id: string | null;
  appointment_date: string;
  start_time: string;
  status: string;
  expires_at: string;
};

interface ScheduleStoreResult {
  teams: Team[];
  agents: Agent[];
  companies: Company[];
  locations: CompanyLocation[];
  bookings: CompanyBooking[];
  portalAppointments: PortalAppointment[];
  companyTeams: CompanyTeam[];
  locationAgents: CompanyLocationAgent[];
  scheduleExceptions: CompanyScheduleException[];
  scheduleRows: ScheduleRow[];
  loading: boolean;
  toggleBooking: (companyId: string, locationId: string | null, day: string, timeSlot: string) => Promise<void>;
  getCompanyTeams: (companyId: string) => Team[];
  isBooked: (companyId: string, locationId: string | null, day: string, timeSlot: string) => boolean;
  isCompanyWideBooked: (companyId: string, day: string, timeSlot: string) => boolean;
  isScheduleExceptionBlocked: (companyId: string, locationId: string | null, day: string, timeSlot: string) => boolean;
  isPortalBooked: (companyId: string, locationId: string | null, day: string, timeSlot: string) => boolean;
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
  const [portalAppointments, setPortalAppointments] = useState<PortalAppointment[]>([]);
  const [portalReservations, setPortalReservations] = useState<PortalReservation[]>([]);
  const [companyTeams, setCompanyTeams] = useState<CompanyTeam[]>([]);
  const [locationAgents, setLocationAgents] = useState<CompanyLocationAgent[]>([]);
  const [scheduleExceptions, setScheduleExceptions] = useState<CompanyScheduleException[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const weekStart = startOfWeek();
    const weekEnd = addDays(weekStart, 6);
    const nowIso = new Date().toISOString();
    const [teamsRes, agentsRes, companiesRes, locationsRes, bookingsRes, appointmentsRes, reservationsRes, ctRes, laRes, exceptionsRes] = await Promise.all([
      supabase.from('teams').select('*'),
      supabase.from('agents').select('*'),
      supabase.from('roster_companies').select('*').order('name'),
      supabase.from('company_locations').select('*').order('sort_order'),
      supabase.from('company_bookings').select('*'),
      supabase
        .from('portal_appointments')
        .select('id,company_id,location_id,appointment_date,start_time,status')
        .gte('appointment_date', localDate(weekStart))
        .lte('appointment_date', localDate(weekEnd)),
      supabase
        .from('appointment_reservations')
        .select('id,company_id,location_id,appointment_date,start_time,status,expires_at')
        .eq('status', 'active')
        .gt('expires_at', nowIso)
        .gte('appointment_date', localDate(weekStart))
        .lte('appointment_date', localDate(weekEnd)),
      supabase.from('company_teams').select('*'),
      supabase.from('company_location_agents').select('*'),
      supabase.from('company_schedule_exceptions').select('*').gte('exception_date', localDate(weekStart)).lte('exception_date', localDate(weekEnd)),
    ]);

    if (teamsRes.data) setTeams(teamsRes.data);
    if (agentsRes.data) setAgents(agentsRes.data);
    if (companiesRes.data) setCompanies(companiesRes.data);
    if (locationsRes.data) setLocations(locationsRes.data);
    if (bookingsRes.data) setBookings(bookingsRes.data);
    if (appointmentsRes.data) {
      setPortalAppointments((appointmentsRes.data as PortalAppointment[]).filter(
        appointment => !['cancelled', 'rescheduled'].includes(appointment.status),
      ));
    }
    if (reservationsRes.data) setPortalReservations(reservationsRes.data as PortalReservation[]);
    if (ctRes.data) setCompanyTeams(ctRes.data);
    if (laRes.data) setLocationAgents(laRes.data as CompanyLocationAgent[]);
    if (exceptionsRes.data) setScheduleExceptions(exceptionsRes.data as CompanyScheduleException[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('schedule-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_bookings' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_appointments' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointment_reservations' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_locations' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_companies' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_teams' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_location_agents' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_schedule_exceptions' }, () => fetchAll())
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
      const companyLocations = locations.filter(l => l.company_id === company.id && l.active !== false);
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
            assignedAgentIds: locationAgents.filter(item => item.location_id === loc.id).map(item => item.agent_id),
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
          assignedAgentIds: [],
        });
      }
    }
    return rows;
  }, [companies, locations, locationAgents]);

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
      b => b.company_id === companyId
        && b.day === day
        && b.time_slot === timeSlot
        && (b.location_id === locationId || (locationId !== null && b.location_id === null))
    );
  };

  const isCompanyWideBooked = (companyId: string, day: string, timeSlot: string): boolean => bookings.some(
    booking => booking.company_id === companyId
      && booking.location_id === null
      && booking.day === day
      && booking.time_slot === timeSlot,
  );

  const isScheduleExceptionBlocked = (companyId: string, locationId: string | null, day: string, timeSlot: string): boolean => {
    const dayIndex = DAYS.findIndex(value => value === day);
    if (dayIndex < 0) return false;
    const exceptionDate = localDate(addDays(startOfWeek(), dayIndex));
    const value = Number(timeSlot);
    const hour = value >= 8 && value <= 11 ? value : value === 12 ? 12 : value + 12;
    const slotStart = hour * 60;
    const slotEnd = slotStart + 60;
    return scheduleExceptions.some(exception => {
      if (exception.company_id !== companyId || exception.exception_date !== exceptionDate) return false;
      if (exception.location_id !== null && exception.location_id !== locationId) return false;
      if (exception.is_closed) return true;
      const exceptionStart = timeToMinutes(exception.start_time, 0);
      const exceptionEnd = timeToMinutes(exception.end_time, 24 * 60);
      return slotStart < exceptionEnd && slotEnd > exceptionStart;
    });
  };

  const isPortalBooked = (companyId: string, locationId: string | null, day: string, timeSlot: string): boolean => {
    const dayIndex = DAYS.findIndex(value => value === day);
    if (dayIndex < 0) return false;

    const appointmentDate = localDate(addDays(startOfWeek(), dayIndex));
    const hour = Number(timeSlot);
    const hour24 = hour >= 8 && hour <= 11 ? hour : hour === 12 ? 12 : hour + 12;
    const startTime = `${String(hour24).padStart(2, '0')}:00`;

    const matchesSlot = (record: { company_id: string; location_id: string | null; appointment_date: string; start_time: string }) =>
      record.company_id === companyId
      && record.appointment_date === appointmentDate
      && record.start_time.slice(0, 5) === startTime
      && (record.location_id === null || record.location_id === locationId);

    const confirmed = portalAppointments.some(matchesSlot);
    const held = portalReservations.some(reservation =>
      reservation.status === 'active'
      && new Date(reservation.expires_at).getTime() > Date.now()
      && matchesSlot(reservation)
    );

    return confirmed || held;
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
    portalAppointments,
    companyTeams,
    locationAgents,
    scheduleExceptions,
    scheduleRows,
    loading,
    toggleBooking,
    getCompanyTeams,
    isBooked,
    isCompanyWideBooked,
    isScheduleExceptionBlocked,
    isPortalBooked,
    updateCompanyStatus,
    addLocation,
    removeLocation,
    setCompanyTeams: setCompanyTeamsAction,
    refetch: fetchAll,
  };
}

function timeToMinutes(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : fallback;
}
