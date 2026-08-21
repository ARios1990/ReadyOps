import { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Package, Plus, Save, UsersRound, X } from 'lucide-react';
import { supabase } from './supabase';
import type { Company, CompanyLocation } from './types';
import { useScheduleStore } from './useScheduleStore';
import { inferUsTimeZone, READYOPS_TIME_ZONES } from './timeZoneUtils';

type ScheduleStore = ReturnType<typeof useScheduleStore>;
type ManagerMode = 'company' | 'locations';

type ManagedLocation = CompanyLocation & {
  office_name?: string | null;
  address?: string | null;
  city?: string | null;
  zip_code?: string | null;
  service_cities?: string[] | null;
  service_zips?: string[] | null;
  phone?: string | null;
  email?: string | null;
  manager_name?: string | null;
  timezone?: string | null;
  available_days?: string[] | null;
  start_time?: string | null;
  end_time?: string | null;
  slot_interval_minutes?: number | null;
  max_per_hour?: number | null;
  max_per_day?: number | null;
  notes?: string | null;
};

type Props = {
  store: ScheduleStore;
  initialMode?: ManagerMode;
  initialCompanyId?: string;
  initialLocationId?: string;
  onClose: () => void;
};

type LocationDraft = {
  location_label: string;
  office_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  service_cities: string;
  service_zips: string;
  phone: string;
  email: string;
  manager_name: string;
  timezone: string;
  available_days: string[];
  start_time: string;
  end_time: string;
  slot_interval_minutes: string;
  max_per_hour: string;
  max_per_day: string;
  notes: string;
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function blankLocation(): LocationDraft {
  return {
    location_label: '',
    office_name: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    service_cities: '',
    service_zips: '',
    phone: '',
    email: '',
    manager_name: '',
    timezone: '',
    available_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    start_time: '09:00',
    end_time: '18:00',
    slot_interval_minutes: '60',
    max_per_hour: '1',
    max_per_day: '5',
    notes: '',
  };
}

function csvArray(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function timeValue(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.slice(0, 5);
}

export function AdminSchedulingManager({ store, initialMode = 'locations', initialCompanyId, initialLocationId, onClose }: Props) {
  const defaultCompanyId = initialCompanyId
    || store.companies.find(company => company.account_status === 'Active')?.id
    || store.companies[0]?.id
    || '';
  const [mode, setMode] = useState<ManagerMode>(initialMode);
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [companyForm, setCompanyForm] = useState<Partial<Company>>({});
  const [companyTeamIds, setCompanyTeamIds] = useState<string[]>([]);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(blankLocation);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [timezoneAuto, setTimezoneAuto] = useState(true);
  const [savedAgentIds, setSavedAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const company = store.companies.find(item => item.id === companyId) || null;
  const companyLocations = useMemo(
    () => store.locations.filter(location => location.company_id === companyId) as ManagedLocation[],
    [store.locations, companyId],
  );

  useEffect(() => {
    if (!company) {
      setCompanyForm({});
      return;
    }
    setCompanyForm({
      name: company.name,
      state: company.state,
      contact_name: company.contact_name,
      phone: company.phone,
      email: company.email,
      website: company.website,
      requirements_note: company.requirements_note,
      notes: company.notes,
      account_status: company.account_status,
    });
    setCompanyTeamIds(store.getCompanyTeams(company.id).map(team => team.id));
  }, [companyId, company]);

  useEffect(() => {
    setEditingLocationId(null);
    setLocationDraft(blankLocation());
    setAssignedAgentIds([]);
    setSavedAgentIds([]);
    setMessage('');
    setError('');
  }, [companyId]);

  useEffect(() => {
    if (!initialLocationId) return;
    const location = companyLocations.find(item => item.id === initialLocationId);
    if (location) void beginEditLocation(location);
  }, [initialLocationId, companyLocations]);

  function setCompanyField<K extends keyof Company>(key: K, value: Company[K]) {
    setCompanyForm(current => ({ ...current, [key]: value }));
  }

  function setLocationField<K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) {
    setLocationDraft(current => ({ ...current, [key]: value }));
  }

  function setLocationGeoField(key: 'city' | 'state' | 'zip_code', value: string) {
    setTimezoneAuto(true);
    setLocationDraft(current => {
      const next = { ...current, [key]: value };
      const inferred = inferUsTimeZone(next.city, next.state, next.zip_code);
      return inferred ? { ...next, timezone: inferred } : next;
    });
  }

  async function saveCompany() {
    if (!companyId || !companyForm.name?.trim()) return;
    setSaving(true);
    setError('');
    setMessage('');
    const { error: updateError } = await supabase
      .from('roster_companies')
      .update({
        name: companyForm.name.trim(),
        state: companyForm.state?.trim() || null,
        contact_name: companyForm.contact_name?.trim() || null,
        phone: companyForm.phone?.trim() || null,
        email: companyForm.email?.trim() || null,
        website: companyForm.website?.trim() || null,
        requirements_note: companyForm.requirements_note?.trim() || null,
        notes: companyForm.notes?.trim() || null,
        account_status: companyForm.account_status || 'Active',
      })
      .eq('id', companyId);

    if (updateError) setError(updateError.message);
    else {
      await store.setCompanyTeams(companyId, companyTeamIds);
      setMessage('Company information saved.');
      await store.refetch();
    }
    setSaving(false);
  }

  async function beginEditLocation(location: ManagedLocation) {
    setEditingLocationId(location.id);
    setTimezoneAuto(false);
    setLocationDraft({
      location_label: location.location_label || '',
      office_name: location.office_name || '',
      address: location.address || '',
      city: location.city || '',
      state: location.state || '',
      zip_code: location.zip_code || '',
      service_cities: (location.service_cities || []).join(', '),
      service_zips: (location.service_zips || []).join(', '),
      phone: location.phone || '',
      email: location.email || '',
      manager_name: location.manager_name || '',
      timezone: location.timezone || 'America/Chicago',
      available_days: location.available_days?.length
        ? location.available_days
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      start_time: timeValue(location.start_time, '09:00'),
      end_time: timeValue(location.end_time, '18:00'),
      slot_interval_minutes: String(location.slot_interval_minutes || 60),
      max_per_hour: String(location.max_per_hour || 1),
      max_per_day: String(location.max_per_day || 5),
      notes: location.notes || '',
    });
    setMessage('');
    setError('');

    const { data, error: assignmentError } = await supabase
      .from('company_location_agents')
      .select('agent_id')
      .eq('location_id', location.id);

    if (assignmentError) {
      setAssignedAgentIds([]);
      setSavedAgentIds([]);
      setError(assignmentError.message);
    } else {
      const agentIds = (data || []).map(item => item.agent_id);
      setAssignedAgentIds(agentIds);
      setSavedAgentIds(agentIds);
    }
  }

  function startNewLocation() {
    setEditingLocationId(null);
    setTimezoneAuto(true);
    setLocationDraft(blankLocation());
    setAssignedAgentIds([]);
    setSavedAgentIds([]);
    setMessage('');
    setError('');
  }

  function toggleDay(day: string) {
    setLocationDraft(current => ({
      ...current,
      available_days: current.available_days.includes(day)
        ? current.available_days.filter(value => value !== day)
        : [...current.available_days, day],
    }));
  }

  function toggleAgent(agentId: string) {
    setAssignedAgentIds(current => (
      current.includes(agentId)
        ? current.filter(id => id !== agentId)
        : [...current, agentId]
    ));
  }

  async function saveLocation() {
    if (!companyId || !locationDraft.location_label.trim()) {
      setError('Location name is required.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');

    const payload = {
      company_id: companyId,
      location_label: locationDraft.location_label.trim(),
      office_name: locationDraft.office_name.trim() || null,
      address: locationDraft.address.trim() || null,
      city: locationDraft.city.trim() || null,
      state: locationDraft.state.trim() || null,
      zip_code: locationDraft.zip_code.trim() || null,
      service_cities: csvArray(locationDraft.service_cities),
      service_zips: csvArray(locationDraft.service_zips),
      phone: locationDraft.phone.trim() || null,
      email: locationDraft.email.trim() || null,
      manager_name: locationDraft.manager_name.trim() || null,
      timezone: locationDraft.timezone.trim() || inferUsTimeZone(locationDraft.city, locationDraft.state, locationDraft.zip_code) || 'America/Chicago',
      available_days: locationDraft.available_days,
      start_time: locationDraft.start_time || '09:00',
      end_time: locationDraft.end_time || '18:00',
      slot_interval_minutes: Math.max(15, Number(locationDraft.slot_interval_minutes) || 60),
      max_per_hour: Math.max(1, Number(locationDraft.max_per_hour) || 1),
      max_per_day: Math.max(1, Number(locationDraft.max_per_day) || 5),
      notes: locationDraft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let locationId = editingLocationId;
    if (editingLocationId) {
      const { error: updateError } = await supabase
        .from('company_locations')
        .update(payload)
        .eq('id', editingLocationId);
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { data, error: insertError } = await supabase
        .from('company_locations')
        .insert(payload)
        .select('id')
        .maybeSingle();

      if (insertError || !data?.id) {
        setError(insertError?.message || 'Unable to create location.');
        setSaving(false);
        return;
      }

      locationId = data.id;

    }

    if (locationId) {
      const agentIdsToAdd = assignedAgentIds.filter(agentId => !savedAgentIds.includes(agentId));
      const agentIdsToRemove = savedAgentIds.filter(agentId => !assignedAgentIds.includes(agentId));
      if (agentIdsToAdd.length > 0) {
        const { error: insertAssignmentError } = await supabase
          .from('company_location_agents')
          .insert(agentIdsToAdd.map(agentId => ({ location_id: locationId, agent_id: agentId })));

        if (insertAssignmentError) {
          setError(insertAssignmentError.message);
          setSaving(false);
          return;
        }
      }
      if (agentIdsToRemove.length > 0) {
        const { error: deleteAssignmentError } = await supabase
          .from('company_location_agents')
          .delete()
          .eq('location_id', locationId)
          .in('agent_id', agentIdsToRemove);
        if (deleteAssignmentError) {
          setError(deleteAssignmentError.message);
          setSaving(false);
          return;
        }
      }
      setSavedAgentIds(assignedAgentIds);
    }

    await store.refetch();
    setEditingLocationId(locationId);
    setMessage(editingLocationId ? 'Location updated.' : 'Location added. A separate time-slot row is now available for this area.');
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-[980px] overflow-y-auto border-l border-slate-200 bg-slate-50 shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Scheduling setup"
      >
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <h2 className="text-lg font-black text-slate-900">Company & Location Setup</h2>
              <p className="text-xs text-slate-500">Edit company information and create separate office/service-area schedules.</p>
            </div>
            <button
              onClick={() => { window.location.href = '/admin/portals'; }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Package size={14} /> Packages
            </button>
            <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="text-xs font-bold text-slate-600">
              Company
              <select
                value={companyId}
                onChange={event => setCompanyId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                {store.companies.map(item => (
                  <option key={item.id} value={item.id}>{item.name}{item.state ? ` - ${item.state}` : ''}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-1 rounded-lg bg-slate-100 p-1">
              <button
                onClick={() => setMode('company')}
                className={`rounded-md px-3 py-2 text-xs font-bold ${mode === 'company' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                <Building2 size={13} className="mr-1 inline" /> Company Info
              </button>
              <button
                onClick={() => setMode('locations')}
                className={`rounded-md px-3 py-2 text-xs font-bold ${mode === 'locations' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                <MapPin size={13} className="mr-1 inline" /> Locations
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

          {mode === 'company' ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h3 className="font-black text-slate-900">Quick Edit Company</h3>
                <p className="text-xs text-slate-500">Update the information most often needed while working the time-slot page.</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Company Name" value={companyForm.name || ''} onChange={value => setCompanyField('name', value)} />
                <Field label="State" value={companyForm.state || ''} onChange={value => setCompanyField('state', value)} />
                <Field label="Primary Contact" value={companyForm.contact_name || ''} onChange={value => setCompanyField('contact_name', value)} />
                <Field label="Phone" value={companyForm.phone || ''} onChange={value => setCompanyField('phone', value)} />
                <Field label="Email" type="email" value={companyForm.email || ''} onChange={value => setCompanyField('email', value)} />
                <Field label="Website" value={companyForm.website || ''} onChange={value => setCompanyField('website', value)} />
                <label className="text-xs font-bold text-slate-600">
                  Status
                  <select value={companyForm.account_status || 'Active'} onChange={event => setCompanyField('account_status', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
                    <option value="Active">Active</option><option value="Pause">Pause</option><option value="Prospect">Prospect</option><option value="Hidden">Hidden</option><option value="No Longer Working">No Longer Working</option>
                  </select>
                </label>
                <TextArea label="Requirements / Time-Slot Note" value={companyForm.requirements_note || ''} onChange={value => setCompanyField('requirements_note', value)} />
                <TextArea label="Internal Notes" value={companyForm.notes || ''} onChange={value => setCompanyField('notes', value)} />
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-4">
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-600">Assigned Teams</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {store.teams.map(team => <label key={team.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold ${companyTeamIds.includes(team.id) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" className="mr-2" checked={companyTeamIds.includes(team.id)} onChange={() => setCompanyTeamIds(current => current.includes(team.id) ? current.filter(id => id !== team.id) : [...current, team.id])}/>{team.abbreviation} — {team.name}</label>)}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => void saveCompany()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={14} /> Save Company
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-auto">
                    <h3 className="font-black text-slate-900">Locations / Offices / Service Areas</h3>
                    <p className="text-xs text-slate-500">Each location appears as its own appointment-availability row and has independent weekly blocks.</p>
                  </div>
                  <button
                    onClick={startNewLocation}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    <Plus size={14} /> Add Another Location
                  </button>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {companyLocations.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      No locations yet. Add the first location below. Existing company-wide blocked slots stay intact and apply as inherited legacy blocks.
                    </div>
                  ) : companyLocations.map(location => (
                    <button
                      key={location.id}
                      onClick={() => void beginEditLocation(location)}
                      className={`rounded-xl border p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40 ${
                        editingLocationId === location.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <MapPin size={15} className="mt-0.5 text-blue-600" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-900">{location.location_label}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {[location.city, location.state, location.zip_code].filter(Boolean).join(', ') || 'Service area'}
                          </div>
                          <div className="mt-1 text-[10px] font-medium text-slate-400">
                            {timeValue(location.start_time, '09:00')}–{timeValue(location.end_time, '18:00')}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <MapPin size={18} className="text-blue-600" />
                  <div>
                    <h3 className="font-black text-slate-900">{editingLocationId ? 'Edit Location' : 'Add Location'}</h3>
                    <p className="text-xs text-slate-500">Use a branch, metro, territory, or office name such as “Austin / Central Texas”.</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Location / Service Area Name *" value={locationDraft.location_label} onChange={value => setLocationField('location_label', value)} placeholder="Austin / Central Texas" />
                  <Field label="Office Name" value={locationDraft.office_name} onChange={value => setLocationField('office_name', value)} placeholder="Austin Office" />
                  <Field label="Street Address" value={locationDraft.address} onChange={value => setLocationField('address', value)} />
                  <Field label="City" value={locationDraft.city} onChange={value => setLocationGeoField('city', value)} />
                  <Field label="State" value={locationDraft.state} onChange={value => setLocationGeoField('state', value)} placeholder="TX" />
                  <Field label="ZIP" value={locationDraft.zip_code} onChange={value => setLocationGeoField('zip_code', value)} />
                  <TextArea label="Service Cities" value={locationDraft.service_cities} onChange={value => setLocationField('service_cities', value)} placeholder="Austin, Buda, Kyle" />
                  <TextArea label="Service ZIP Codes" value={locationDraft.service_zips} onChange={value => setLocationField('service_zips', value)} placeholder="78610, 78633, 78640" />
                  <Field label="Office Phone" value={locationDraft.phone} onChange={value => setLocationField('phone', value)} />
                  <Field label="Office Email" type="email" value={locationDraft.email} onChange={value => setLocationField('email', value)} />
                  <Field label="Manager / Office Contact" value={locationDraft.manager_name} onChange={value => setLocationField('manager_name', value)} />
                  <label className="text-xs font-bold text-slate-600">
                    Time Zone {timezoneAuto ? <span className="font-semibold text-emerald-600">• Auto-detected</span> : <span className="font-semibold text-amber-600">• Manual override</span>}
                    <select
                      value={locationDraft.timezone}
                      onChange={event => { setTimezoneAuto(false); setLocationField('timezone', event.target.value); }}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {!locationDraft.timezone && <option value="">Enter City / State / ZIP to auto-detect</option>}
                      {READYOPS_TIME_ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                    </select>
                    <span className="mt-1 block text-[10px] font-normal text-slate-400">ReadyOps fills this from the location. You can change it anytime if the service area crosses a time-zone boundary.</span>
                  </label>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-xs font-black uppercase tracking-wide text-slate-600">Location Scheduling</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {DAYS.map(day => (
                      <label
                        key={day}
                        className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                          locationDraft.available_days.includes(day)
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-400'
                        }`}
                      >
                        <input type="checkbox" checked={locationDraft.available_days.includes(day)} onChange={() => toggleDay(day)} className="hidden" />
                        {day.slice(0, 3)}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field label="Start Time" type="time" value={locationDraft.start_time} onChange={value => setLocationField('start_time', value)} />
                    <Field label="End Time" type="time" value={locationDraft.end_time} onChange={value => setLocationField('end_time', value)} />
                    <Field label="Slot Minutes" type="number" value={locationDraft.slot_interval_minutes} onChange={value => setLocationField('slot_interval_minutes', value)} />
                    <Field label="Max / Hour" type="number" value={locationDraft.max_per_hour} onChange={value => setLocationField('max_per_hour', value)} />
                    <Field label="Max / Day" type="number" value={locationDraft.max_per_day} onChange={value => setLocationField('max_per_day', value)} />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <UsersRound size={15} className="text-purple-600" />
                    <h4 className="text-xs font-black uppercase tracking-wide text-slate-600">Assigned Reps / Agents</h4>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {store.agents.map(agent => (
                      <label
                        key={agent.id}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold ${
                          assignedAgentIds.includes(agent.id)
                            ? 'border-purple-300 bg-purple-50 text-purple-700'
                            : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={assignedAgentIds.includes(agent.id)}
                          onChange={() => toggleAgent(agent.id)}
                          className="mr-2"
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <TextArea label="Location Notes" value={locationDraft.notes} onChange={value => setLocationField('notes', value)} placeholder="Office-specific scheduling or service-area notes..." />
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  {editingLocationId && (
                    <button onClick={startNewLocation} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                      New Location
                    </button>
                  )}
                  <button
                    onClick={() => void saveLocation()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save size={14} /> {editingLocationId ? 'Save Location' : 'Add Location'}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
