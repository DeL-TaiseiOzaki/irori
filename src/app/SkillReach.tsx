import { Dialog } from './Dialog';
import { useResource } from './useResource';
import { agentIds, agentNames, type AgentId } from '../domain/types';
import { skillReachRules, type SkillReachEntry } from '../domain/skill-reach';
import { t } from '../domain/i18n';
import './skill-reach.css';

const host = window.irori;
// Values are functions so that they are read in the language of each render.
const nativeText = {
  reads: () => t('読む', 'reads it'),
  trusted: () => t('信頼済みなら読む', 'reads it if trusted'),
  ignores: () => t('読まない', 'does not read it'),
};
const clashText = {
  'user-wins': () => t('そちらが優先される', 'that one takes priority'),
  both: () => t('両方が並ぶ', 'both are listed'),
  unspecified: () => t('どちらが残るかは未定義', 'which remains is undefined'),
};

function cell(entry: SkillReachEntry, agent: AgentId) {
  const rule = skillReachRules[agent];
  const copies = rule.user.filter((dir) => entry.found.includes(dir));
  if (entry.retired)
    return copies.length
      ? t(
          `退役した名前が ${copies.join('、')} に残っている`,
          `A retired name remains in ${copies.join(', ')}`,
        )
      : '—';
  if (!copies.length) return nativeText[rule.native]();
  const fate =
    rule.native === 'ignores'
      ? t('そちらだけを読む', 'only that one is read')
      : clashText[rule.clash]();
  return t(
    `${nativeText[rule.native]()}。同名が ${copies.join('、')} にあり、${fate}`,
    `${nativeText[rule.native]()}; a same-named one exists in ${copies.join(', ')}, and ${fate}`,
  );
}

/** Whether each harness would find the KB's skills on its own, and whether a
 * same-named personal skill hides them. Read-only; the host never says where home is. */
export function SkillReach({ scopeId, onClose }: { scopeId: string; onClose: () => void }) {
  const read = useResource(() => host.skillReach(scopeId), [scopeId]);
  return (
    <Dialog label={t('スキルの到達', 'Skill reach')} onClose={onClose}>
      <div className="modal skill-reach">
        <h2>{t('スキルの到達', 'Skill reach')}</h2>
        <p className="hint">
          {t(
            '選んだスキルは irori がどのエージェントにも指示に含めて渡します。この表は、この KB で起動した各 CLI が自力で見つけるか、同名の個人スキルに隠されないかを示します。',
            'irori includes the selected skills in the instructions for every agent. This table shows whether each CLI started in this KB would find them on its own, and whether a same-named personal skill hides them.',
          )}
        </p>
        {read.error && <div role="alert">{read.error}</div>}
        {read.data &&
          (read.data.entries.length ? (
            <table>
              <thead>
                <tr>
                  <th>{t('スキル', 'Skill')}</th>
                  {agentIds.map((id) => (
                    <th key={id}>{agentNames[id]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {read.data.entries.map((entry) => (
                  <tr key={entry.name}>
                    <th scope="row">
                      {entry.name}
                      {entry.retired && t('（退役）', ' (retired)')}
                    </th>
                    {agentIds.map((id) => (
                      <td key={id}>{cell(entry, id)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{t('このスペースにスキルはありません。', 'There are no skills in this space.')}</p>
          ))}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('閉じる', 'Close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
