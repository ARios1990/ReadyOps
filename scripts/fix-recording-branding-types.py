from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'Pattern not found in {path}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

patch('src/AgentBookingPortal.tsx', '{formValues.recording_url &&', '{Boolean(formValues.recording_url) &&')
patch('src/Dashboard.tsx', '  Calendar, LogOut, Building2, Users, RefreshCw, MapPin,', '  LogOut, Building2, Users, RefreshCw, MapPin,')
print('Fixed recording/branding TypeScript issues.')
