import { useEffect, useState } from 'react';
import { skillVisible, type AgentSkill, type SkillAudience } from '../domain/skills';
import { chooseSkillAudience, currentSkillAudience } from './device-settings';
import { SkillReach } from './SkillReach';

/**
 * The composer's skill choice for one KB. A reader who chose a role or project on
 * this device sees the skills for it plus the unscoped ones; the choice never
 * enters the KB. Mount with `key={scopeId}` so a space change starts afresh.
 */
export function SkillPicker({
  scopeId,
  skills,
  value,
  onChange,
  disabled,
}: {
  scopeId: string;
  skills: AgentSkill[];
  value: string;
  onChange: (name: string) => void;
  disabled: boolean;
}) {
  const [audience, setAudience] = useState(() => currentSkillAudience(scopeId));
  const [reach, setReach] = useState(false);
  const declared = (key: 'roles' | 'projects', chosen?: string) =>
    [...new Set([...skills.flatMap((s) => s[key]), ...(chosen ? [chosen] : [])])].sort();
  const roles = declared('roles', audience.role);
  const projects = declared('projects', audience.project);
  const visible = skills.filter((s) => skillVisible(s, audience));
  const shown = visible.map((s) => s.name).join(' ');
  // A choice the narrowing hides must not be sent.
  useEffect(() => {
    if (value && !visible.some((s) => s.name === value)) onChange('');
  }, [value, shown]);
  const choose = (patch: SkillAudience) => {
    const next = { ...audience, ...patch };
    setAudience(next);
    void chooseSkillAudience(scopeId, next).catch(() => undefined);
  };
  const select = (
    label: string,
    options: string[],
    chosen: string | undefined,
    change: (next?: string) => void,
  ) =>
    options.length > 0 && (
      <select
        aria-label={label}
        value={chosen ?? ''}
        disabled={disabled}
        onChange={(e) => change(e.target.value || undefined)}
      >
        <option value="">{label}: すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  return (
    <>
      {select('役割', roles, audience.role, (role) => choose({ role }))}
      {select('プロジェクト', projects, audience.project, (project) => choose({ project }))}
      {skills.length > 0 && (
        <select
          aria-label="スキル"
          className="composer-skill"
          value={value}
          title={skills.find((s) => s.name === value)?.description ?? 'スキルを使わない'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">スキルなし</option>
          {visible.map((s) => (
            <option key={s.name} value={s.name} title={s.description}>
              {s.name} — {s.description}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={disabled}
        title="各エージェントがこの KB のスキルを自力で見つけるかを確認します"
        onClick={() => setReach(true)}
      >
        到達確認
      </button>
      {reach && <SkillReach scopeId={scopeId} onClose={() => setReach(false)} />}
    </>
  );
}
