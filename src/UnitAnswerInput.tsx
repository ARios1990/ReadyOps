import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { formatRoofAge, formatStories, normalizeRoofAgeInput, normalizeStoriesInput } from './portalUtils';

export function UnitAnswerInput({ field, value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { field: 'roof_age' | 'stories'; value: unknown; onValueChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const normalize = field === 'roof_age' ? normalizeRoofAgeInput : normalizeStoriesInput;
  const format = field === 'roof_age' ? formatRoofAge : formatStories;
  const text = String(value ?? '');
  const [draft, setDraft] = useState(() => text.trim() ? format(text) : '');
  useEffect(() => { if (!editing) setDraft(text.trim() ? format(text) : ''); }, [editing, text, format]);
  return <input {...props} type="text" value={draft}
    pattern={field === 'roof_age' ? '[0-9]+(?:[+]|-[0-9]+)?(?:[ ]*[Yy][Ee][Aa][Rr][Ss]?)?' : undefined}
    onFocus={() => setEditing(true)}
    onChange={event => { setDraft(event.target.value); onValueChange(event.target.value); }}
    onBlur={() => { onValueChange(normalize(draft)); setDraft(draft.trim() ? format(draft) : ''); setEditing(false); }} />;
}
