import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { convertToContentType } from '@content/content-utils';
import { GUIDE_BLUE } from '@constants/data';
import { AbilityBlockType, ContentType } from '@schemas/content';
import { Phase1ContentPickButton } from './content-picker';
import { OperationWrapper } from './operation-section';
import { OpsSelect } from './ops-ui';

export function InjectTextOp(props: {
  type: ContentType | AbilityBlockType;
  id: number;
  text: string;
  onChange: (type: ContentType | AbilityBlockType, id: number, text: string) => void;
  onRemove: () => void;
}) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Inject Text'>
      <div className='w-full space-y-2'>
        <div className='flex flex-wrap gap-2'>
          <OpsSelect
            className='w-[140px]'
            placeholder='Content Type'
            value={props.type}
            onChange={(value) => props.onChange(value as ContentType | AbilityBlockType, -1, props.text)}
            options={[
              { value: 'feat', label: 'Feat' },
              { value: 'action', label: 'Action' },
              { value: 'spell', label: 'Spell' },
              { value: 'item', label: 'Item' },
              { value: 'trait', label: 'Trait' },
              { value: 'class-feature', label: 'Class Feature' },
              { value: 'physical-feature', label: 'Physical Feature' },
              { value: 'mode', label: 'Mode' },
              { value: 'sense', label: 'Sense' },
              { value: 'heritage', label: 'Heritage' },
              { value: 'language', label: 'Language' },
            ]}
          />
          <Phase1ContentPickButton
            type={convertToContentType(props.type)}
            selectedId={props.id}
            abilityBlockType={convertToContentType(props.type) === 'ability-block' ? (props.type as AbilityBlockType) : undefined}
            onSelect={(option) => props.onChange(props.type, option.id, props.text)}
          />
        </div>
        <Textarea value={props.text} onChange={(event) => props.onChange(props.type, props.id, event.target.value)} />
      </div>
    </OperationWrapper>
  );
}

const SWATCHES = [
  '#25262b',
  '#868e96',
  '#fa5252',
  '#e64980',
  '#be4bdb',
  '#8d69f5',
  '#577deb',
  GUIDE_BLUE,
  '#15aabf',
  '#12b886',
  '#40c057',
  '#82c91e',
  '#fab005',
  '#fd7e14',
];

export function SendNotificationOp(props: {
  title: string;
  message: string;
  color: string;
  onChange: (title: string, message: string, color: string) => void;
  onRemove: () => void;
}) {
  return (
    <OperationWrapper onRemove={props.onRemove} title='Send Notification'>
      <div className='w-full space-y-2'>
        <div className='flex gap-2'>
          <label className='flex-1 text-sm'>
            Title
            <Input
              className='mt-1'
              placeholder='Title'
              value={props.title}
              onChange={(e) => props.onChange(e.target.value, props.message, props.color)}
            />
          </label>
          <label className='w-[140px] text-sm'>
            Color
            <input
              type='color'
              className='mt-1 h-8 w-full border border-p1-border bg-p1-inset'
              value={props.color || '#228be6'}
              onChange={(e) => props.onChange(props.title, props.message, e.target.value)}
            />
            <div className='mt-1 grid grid-cols-7 gap-0.5'>
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type='button'
                  className='h-4 w-4 border border-p1-border'
                  style={{ background: color }}
                  onClick={() => props.onChange(props.title, props.message, color)}
                />
              ))}
            </div>
          </label>
        </div>
        <label className='block text-sm'>
          Message
          <Textarea
            className='mt-1'
            placeholder='Message'
            value={props.message}
            onChange={(e) => props.onChange(props.title, e.target.value, props.color)}
          />
        </label>
      </div>
    </OperationWrapper>
  );
}
