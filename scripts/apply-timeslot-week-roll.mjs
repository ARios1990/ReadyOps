import fs from 'node:fs';

const path = 'src/Dashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to) {
  if (!code.includes(from)) throw new Error(`Missing Dashboard target: ${from.slice(0, 100)}`);
  code = code.replace(from, to);
}

replaceOnce("import { useState } from 'react';", "import { useEffect, useState } from 'react';");
replaceOnce(
  "import { addDays, formatDateShort, localDate, startOfWeek } from './portalUtils';",
  "import { addDays, formatDateShort, localDate, scheduleWeekStart } from './portalUtils';",
);
replaceOnce(
  "  const [adminView, setAdminView] = useState<'overview' | 'slots'>('overview');",
  "  const [adminView, setAdminView] = useState<'overview' | 'slots'>('overview');\n  const [scheduleWeekAnchor, setScheduleWeekAnchor] = useState(() => scheduleWeekStart());\n\n  useEffect(() => {\n    const refreshScheduleWeek = () => {\n      const next = scheduleWeekStart();\n      setScheduleWeekAnchor(current => localDate(current) === localDate(next) ? current : next);\n    };\n    refreshScheduleWeek();\n    const timer = window.setInterval(refreshScheduleWeek, 60_000);\n    window.addEventListener('focus', refreshScheduleWeek);\n    return () => {\n      window.clearInterval(timer);\n      window.removeEventListener('focus', refreshScheduleWeek);\n    };\n  }, []);",
);

code = code.replaceAll('startOfWeek()', 'scheduleWeekAnchor');

fs.writeFileSync(path, code);
console.log('Applied automatic Time Slots week rollover.');
