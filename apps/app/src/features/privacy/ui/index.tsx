import { Segmented } from '@/components/ui';
import { useApp } from '@/state';
import { VISIBILITY_OPTIONS, type Visibility } from '../model';

/** 「项目 / 仅自己」 for the next import or a new item. */
export function VisibilityToggle({ value, onChange, size = 'sm' }: { value: Visibility; onChange: (v: Visibility) => void; size?: 'sm' | 'md' }) {
  const { t } = useApp();
  return <Segmented size={size} value={value} onChange={onChange} accessibilityLabel={t('in.privacy')} options={VISIBILITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))} />;
}

/** 「仅你可见」 on my own private items: muted text, no dot. */
export { MutedTag } from '../../inputs/ui/common';
