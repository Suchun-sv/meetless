import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { newId } from '../model/ids';
import { newProjectCommands } from './model';
import { Btn } from '../ui/primitives';
import './setup.css';

/**
 * A name field, an optional description, optional DDLs (a name and a date each, 「再加一个」) and
 * create: submits `project.created` and a `round.created` per DDL, then opens the new project's
 * dashboard. DDLs can also be added later in the project's DDL settings.
 */
export function NewProjectPage(_props: PageProps) {
  const { t, submit, go, today } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ddls, setDdls] = useState<{ title: string; due: string }[]>([{ title: '', due: '' }]);
  const [busy, setBusy] = useState(false);
  const setDdl = (i: number, patch: Partial<{ title: string; due: string }>) => setDdls((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const create = async () => {
    if (busy) return;
    const projectId = newId('p');
    const cmds = newProjectCommands({ projectId, name, description, ddls, today, roundId: () => newId('rnd') });
    if (!cmds.length) return;
    setBusy(true);
    let ok = true;
    for (const cmd of cmds) {
      const r = await submit(cmd.type, cmd.payload);
      if (r.kind === 'rejected') {
        ok = cmd.type !== 'project.created';
        break;
      }
    }
    setBusy(false);
    if (ok) go({ view: 'dash', projectId });
  };
  return (
    <div className="page" data-testid="page-newProject">
      <h1>{t('pj.title')}</h1>
      <form
        className="np-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pj.namePh')} aria-label={t('pj.name')} data-testid="project-name" />
        <input
          className="inp"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('pj.descr')}
          aria-label={t('pj.descr')}
          data-testid="project-descr"
        />
        <div className="np-ddls">
          <span className="small faint">{t('pj.ddls')}</span>
          {ddls.map((d, i) => (
            <div key={i} className="row gap6 wrap">
              <input className="inp grow" value={d.title} onChange={(e) => setDdl(i, { title: e.target.value })} placeholder={t('pj.ddlTitle')} aria-label={t('pj.ddlTitle')} data-testid="np-ddl-title" />
              <input className="inp" type="date" value={d.due} onChange={(e) => setDdl(i, { due: e.target.value })} aria-label={t('pj.ddlDue')} data-testid="np-ddl-due" />
            </div>
          ))}
          <button type="button" className="link small" data-testid="np-ddl-add" onClick={() => setDdls((cur) => [...cur, { title: '', due: '' }])}>
            {t('pj.addDdl')}
          </button>
        </div>
        <Btn kind="primary" type="submit" disabled={!name.trim() || busy} testId="project-create">
          {t('pj.create')}
        </Btn>
      </form>
    </div>
  );
}
