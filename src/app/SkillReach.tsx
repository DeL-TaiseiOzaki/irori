import { Dialog } from './Dialog';
import { useResource } from './useResource';
import { agentIds, agentNames, type AgentId } from '../domain/types';
import { skillReachRules, type SkillReachEntry } from '../domain/skill-reach';
import './skill-reach.css';

const host = window.irori;
const nativeText = { reads: '読む', trusted: '信頼済みなら読む', ignores: '読まない' };
const clashText = {
  'user-wins': 'そちらが優先される',
  both: '両方が並ぶ',
  unspecified: 'どちらが残るかは未定義',
};

function cell(entry: SkillReachEntry, agent: AgentId) {
  const rule = skillReachRules[agent];
  const copies = rule.user.filter((dir) => entry.found.includes(dir));
  if (entry.retired)
    return copies.length ? `退役した名前が ${copies.join('、')} に残っている` : '—';
  if (!copies.length) return nativeText[rule.native];
  const fate = rule.native === 'ignores' ? 'そちらだけを読む' : clashText[rule.clash];
  return `${nativeText[rule.native]}。同名が ${copies.join('、')} にあり、${fate}`;
}

/** Whether each harness would find the KB's skills on its own, and whether a
 * same-named personal skill hides them. Read-only; the host never says where home is. */
export function SkillReach({ scopeId, onClose }: { scopeId: string; onClose: () => void }) {
  const read = useResource(() => host.skillReach(scopeId), [scopeId]);
  return (
    <Dialog label="スキルの到達" onClose={onClose}>
      <div className="modal skill-reach">
        <h2>スキルの到達</h2>
        <p className="hint">
          選んだスキルは irori がどのエージェントにも指示に含めて渡します。この表は、この KB
          で起動した各 CLI が自力で見つけるか、同名の個人スキルに隠されないかを示します。
        </p>
        {read.error && <div role="alert">{read.error}</div>}
        {read.data &&
          (read.data.entries.length ? (
            <table>
              <thead>
                <tr>
                  <th>スキル</th>
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
                      {entry.retired && '（退役）'}
                    </th>
                    {agentIds.map((id) => (
                      <td key={id}>{cell(entry, id)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>このスペースにスキルはありません。</p>
          ))}
        <div className="actions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Dialog>
  );
}
