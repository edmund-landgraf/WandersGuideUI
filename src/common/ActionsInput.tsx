import { Group, Select, SelectProps } from "@mantine/core";
import { ActionCost } from "@schemas/content";
import { ActionSymbol } from "./Actions";

interface ActionsInputProps extends SelectProps {}

const ACTION_OPTIONS: { value: Exclude<ActionCost, null>; label: string }[] = [
  { value: "ONE-ACTION", label: "Single Action" },
  { value: "TWO-ACTIONS", label: "Two Actions" },
  { value: "THREE-ACTIONS", label: "Three Actions" },
  { value: "FREE-ACTION", label: "Free Action" },
  { value: "REACTION", label: "Reaction" },
  { value: "ONE-TO-TWO-ACTIONS", label: "1 to 2" },
  { value: "ONE-TO-THREE-ACTIONS", label: "1 to 3" },
  { value: "TWO-TO-THREE-ACTIONS", label: "2 to 3" },
];

export default function ActionsInput(props: ActionsInputProps) {
  const selected = (props.value ?? props.defaultValue) as ActionCost | undefined;

  return (
    <Select
      {...props}
      data={ACTION_OPTIONS}
      leftSection={selected ? <ActionSymbol cost={selected} size={16} /> : undefined}
      leftSectionPointerEvents="none"
      renderOption={({ option }) => (
        <Group gap={8} wrap="nowrap">
          <ActionSymbol cost={option.value as ActionCost} size={18} />
        </Group>
      )}
    />
  );
}
