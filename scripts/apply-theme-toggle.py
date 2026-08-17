from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src' / 'Dashboard.tsx'
text = path.read_text(encoding='utf-8')

import_line = "import { ThemeToggle } from './ThemeContext';"
if import_line not in text:
    marker = "import { READYOPS_LOGO_DATA_URI } from './brand';"
    if marker not in text:
        raise RuntimeError('Dashboard brand import marker not found')
    text = text.replace(marker, marker + "\n" + import_line, 1)

signout_marker = "            <button\n              onClick={signOut}"
if '<ThemeToggle />' not in text:
    if signout_marker not in text:
        raise RuntimeError('Dashboard sign-out button marker not found')
    text = text.replace(signout_marker, "            <ThemeToggle />\n\n" + signout_marker, 1)

path.write_text(text, encoding='utf-8')
print('Dashboard theme toggle applied.')
