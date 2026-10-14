import { useState, type InputHTMLAttributes } from 'react';
import { formatRoofAge, formatStories, normalizeRoofAgeInput, normalizeStoriesInput } from './portalUtils';

export function UnitAnswerInput({ field, value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { field: 'roof_age' | 'stories'; value: unknown; onValueChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const normalize = field === 'roof_age' ? normalizeRoofAgeInput : normalizeStoriesInput;
  const format = field === 'roof_age' ? formatRoofAge : formatStories;
  const text = String(value ?? '');
  return <input {...props} type="text" value={editing ? text : text.trim() ? format(text) : ''}
    pattern={field === 'roof_age' ? '[0-9]+(?:[+]|-[0-9]+)?(?:[ ]*[Yy][Ee][Aa][Rr][Ss]?)?' : undefined}
    onFocus={() => { onValueChange(normalize(value)); setEditing(true); }}
    onChange={event => onValueChange(event.target.value)}
    onBlur={() => { onValueChange(normalize(value)); setEditing(false); }} />;
}
