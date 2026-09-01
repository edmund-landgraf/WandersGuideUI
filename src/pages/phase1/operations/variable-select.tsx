import { Variable, VariableType } from '@schemas/variables';
import { HIDDEN_VARIABLES, getVariables } from '@variables/variable-manager';
import { OpsCombobox } from './ops-ui';

export function Phase1VariableSelect(props: {
  value: string;
  variableType?: VariableType;
  onChange: (value: string, variable?: Variable) => void;
}) {
  const names = Object.keys(getVariables('CHARACTER')).filter((variable) => {
    if (variable.startsWith('CS:') || variable.endsWith('____') || variable.endsWith('_IDS') || HIDDEN_VARIABLES.includes(variable)) {
      return false;
    }
    if (props.variableType) return getVariables('CHARACTER')[variable].type === props.variableType;
    return true;
  });

  return (
    <OpsCombobox
      fontMono
      placeholder='Value'
      value={props.value}
      options={names}
      onChange={(raw) => {
        const variable = raw.toUpperCase().replace(/\s/g, '_');
        props.onChange(variable, getVariables('CHARACTER')[variable]);
      }}
    />
  );
}
