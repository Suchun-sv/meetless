import { useApp } from '../app/AppContext';
import { VIEW_TITLE_KEY, type View } from '../app/routes';

/** Stands in for a page its block has not built yet. */
export function Placeholder({ view }: { view: View }) {
  const { t } = useApp();
  return (
    <div className="page" data-testid={`page-${view}`}>
      <h1>{t(VIEW_TITLE_KEY[view])}</h1>
    </div>
  );
}
