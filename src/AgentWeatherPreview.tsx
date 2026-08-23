import { useEffect, useMemo, useState } from 'react';
import { CloudDrizzle, CloudLightning, CloudRain, CloudSun, Loader2, Snowflake, Sun, Wind } from 'lucide-react';

type WeatherQuality = 'good' | 'caution' | 'poor';

type DailyWeather = {
  date: string;
  weatherCode: number;
  tempMaxF: number;
  rainChance: number;
  windMph: number;
};

type GeocodeResult = {
  latitude: number;
  longitude: number;
  name?: string;
  admin1?: string;
  country_code?: string;
};

type GeocodeResponse = { results?: GeocodeResult[] };

type ForecastResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
};

type WeatherCacheEntry = {
  expiresAt: number;
  locationLabel: string;
  daily: Record<string, DailyWeather>;
};

const cache = new Map<string, WeatherCacheEntry>();
const CACHE_MS = 30 * 60 * 1000;

function weatherMeta(code: number): { label: string; icon: React.ReactNode } {
  if (code === 0) return { label: 'Clear', icon: <Sun size={18} /> };
  if (code <= 3) return { label: 'Partly Cloudy', icon: <CloudSun size={18} /> };
  if ([45, 48, 51, 53, 55, 56, 57].includes(code)) return { label: 'Drizzle/Fog', icon: <CloudDrizzle size={18} /> };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Rain', icon: <CloudRain size={18} /> };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow', icon: <Snowflake size={18} /> };
  if ([95, 96, 99].includes(code)) return { label: 'Storm', icon: <CloudLightning size={18} /> };
  return { label: 'Weather', icon: <CloudSun size={18} /> };
}

function roofingQuality(weather: DailyWeather): WeatherQuality {
  if (weather.rainChance >= 65 || weather.windMph >= 25 || [95, 96, 99].includes(weather.weatherCode)) return 'poor';
  if (weather.rainChance >= 35 || weather.windMph >= 18 || weather.tempMaxF >= 100 || weather.tempMaxF <= 35) return 'caution';
  return 'good';
}

function qualityClasses(quality: WeatherQuality): string {
  if (quality === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (quality === 'caution') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-red-200 bg-red-50 text-red-700';
}

function qualityLabel(quality: WeatherQuality): string {
  if (quality === 'good') return 'Good';
  if (quality === 'caution') return 'Caution';
  return 'Poor';
}

function normalizeSearch(parts: Array<string | null | undefined>): string {
  return parts.map(part => (part || '').trim()).filter(Boolean).join(', ');
}

async function geocode(search: string): Promise<GeocodeResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', search);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error('Weather location lookup failed.');
  const data = await response.json() as GeocodeResponse;
  if (!data.results?.length) return null;
  return data.results.find(item => item.country_code === 'US') || data.results[0] || null;
}

async function fetchForecast(latitude: number, longitude: number): Promise<Record<string, DailyWeather>> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '16');
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error('Weather forecast is temporarily unavailable.');
  const data = await response.json() as ForecastResponse;
  const daily = data.daily;
  if (!daily?.time?.length) return {};
  const result: Record<string, DailyWeather> = {};
  daily.time.forEach((date, index) => {
    result[date] = {
      date,
      weatherCode: daily.weather_code?.[index] ?? 0,
      tempMaxF: daily.temperature_2m_max?.[index] ?? 0,
      rainChance: daily.precipitation_probability_max?.[index] ?? 0,
      windMph: daily.wind_speed_10m_max?.[index] ?? 0,
    };
  });
  return result;
}

// Weather hooks are intentionally colocated with the small display components they power.
// eslint-disable-next-line react-refresh/only-export-components
export function useWeeklyWeather({
  city,
  state,
  zip,
  serviceArea,
  serviceAreaState,
  serviceAreaZip,
}: {
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  serviceArea?: string | null;
  serviceAreaState?: string | null;
  serviceAreaZip?: string | null;
}) {
  const search = useMemo(() => {
    const leadLocation = normalizeSearch([city, state, zip]);
    if (leadLocation) return leadLocation;
    return normalizeSearch([serviceArea, serviceAreaState, serviceAreaZip]);
  }, [city, state, zip, serviceArea, serviceAreaState, serviceAreaZip]);

  const [daily, setDaily] = useState<Record<string, DailyWeather>>({});
  const [locationLabel, setLocationLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!search) {
      setDaily({});
      setLocationLabel('');
      setError('');
      return () => { active = false; };
    }

    const cached = cache.get(search.toLowerCase());
    if (cached && cached.expiresAt > Date.now()) {
      setDaily(cached.daily);
      setLocationLabel(cached.locationLabel);
      setError('');
      return () => { active = false; };
    }

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const place = await geocode(search);
        if (!place) throw new Error('Select a service area or provide a city/ZIP to show weather.');
        const forecast = await fetchForecast(place.latitude, place.longitude);
        const label = normalizeSearch([place.name, place.admin1]);
        cache.set(search.toLowerCase(), { expiresAt: Date.now() + CACHE_MS, locationLabel: label, daily: forecast });
        if (!active) return;
        setDaily(forecast);
        setLocationLabel(label);
      } catch (reason) {
        if (!active) return;
        setDaily({});
        setLocationLabel('');
        setError(reason instanceof Error ? reason.message : 'Weather unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [search]);

  return { daily, locationLabel, loading, error, hasLocation: Boolean(search) };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppointmentWeather({
  date,
  city,
  state,
  zip,
}: {
  date: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const weekly = useWeeklyWeather({ city, state, zip });
  return { weather: weekly.daily[date], loading: weekly.loading, hasLocation: weekly.hasLocation, error: weekly.error, locationLabel: weekly.locationLabel };
}

export function AppointmentWeatherBadge({
  date,
  city,
  state,
  zip,
  size = 'sm',
}: {
  date: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  size?: 'sm' | 'lg';
}) {
  const { weather, loading, hasLocation } = useAppointmentWeather({ date, city, state, zip });

  if (!hasLocation) return null;
  if (loading) return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><Loader2 size={12} className="animate-spin" /> Weather</span>;
  if (!weather) return null;

  const meta = weatherMeta(weather.weatherCode);
  const quality = roofingQuality(weather);
  const base = size === 'lg' ? 'text-xs' : 'text-[11px]';
  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-semibold ${base} ${qualityClasses(quality)}`}>
      <span className="text-sky-600">{meta.icon}</span>
      <span className="font-black">{Math.round(weather.tempMaxF)}°</span>
      <span>• {Math.round(weather.rainChance)}% rain</span>
      <span className="inline-flex items-center gap-1"><Wind size={11} /> {Math.round(weather.windMph)} mph</span>
      <span className={`rounded-full border px-2 py-0.5 font-black ${qualityClasses(quality)}`}>{qualityLabel(quality)}</span>
    </div>
  );
}

export function AgentWeatherPreview({ weather, loading, hasLocation }: { weather?: DailyWeather; loading: boolean; hasLocation: boolean }) {
  if (loading) {
    return <div className="flex min-w-0 items-center justify-center gap-2 text-xs font-semibold text-slate-400"><Loader2 size={14} className="animate-spin" /> Weather</div>;
  }
  if (!hasLocation) {
    return <div className="min-w-0 text-center text-[11px] font-semibold text-slate-400">Add city/ZIP or select an area for weather</div>;
  }
  if (!weather) {
    return <div className="min-w-0 text-center text-[11px] font-semibold text-slate-400">Forecast not available yet</div>;
  }

  const meta = weatherMeta(weather.weatherCode);
  const quality = roofingQuality(weather);
  return (
    <div className="flex min-w-0 flex-col items-center justify-center text-center">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
        <span className="text-sky-600">{meta.icon}</span>
        <span>{Math.round(weather.tempMaxF)}°</span>
        <span className="font-semibold text-slate-400">•</span>
        <span>{Math.round(weather.rainChance)}% rain</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-slate-500">
        <span>{meta.label}</span>
        <span className="inline-flex items-center gap-1"><Wind size={10} /> {Math.round(weather.windMph)} mph</span>
        <span className={`rounded-full border px-2 py-0.5 font-black ${qualityClasses(quality)}`}>{qualityLabel(quality)}</span>
      </div>
    </div>
  );
}
