import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { defaultLayerLabel, namedLayers, type NamedLayer } from '../domain/layers';
import { t } from '../domain/i18n';
import { Icon } from './Icon';

const layerIcons = { Knowledge_Base: 'book', contents: 'cloud' } as const;

/**
 * Which layers a vault has (ADR 070): Schema, always, and a choice for each of
 * Knowledge and Contents. The vault's settings and the forms that make a vault
 * (ADR 072) show the same one.
 */
export function LayerChoice({
  value,
  disabled = false,
  onChange,
}: {
  value: readonly NamedLayer[];
  disabled?: boolean;
  onChange: (layers: NamedLayer[]) => void;
}) {
  return (
    <fieldset className="layer-choice">
      <legend>{t('この vault が持つ層', 'The layers this vault has')}</legend>
      <CheckboxInput
        label={defaultLayerLabel('schema')}
        labelIcon={<Icon name="schema" size={15} className="layer-icon schema" />}
        value
        isReadOnly
        isDisabled
      />
      {namedLayers.map((layer) => (
        <CheckboxInput
          key={layer}
          label={defaultLayerLabel(layer)}
          labelIcon={<Icon name={layerIcons[layer]} size={15} className={`layer-icon ${layer}`} />}
          value={value.includes(layer)}
          isDisabled={disabled}
          onChange={(checked) =>
            onChange(
              namedLayers.filter((item) => (item === layer ? checked : value.includes(item))),
            )
          }
        />
      ))}
    </fieldset>
  );
}
