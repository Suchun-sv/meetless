import { useState } from 'react';
import { useApp } from '../app/AppContext';
import type { PageProps } from '../app/pages';
import { newId } from '../model/ids';
import { newProjectCommands } from './model';
import { Btn } from '../ui/primitives';
import './setup.css';

/** A name field, an optional description and create: submits `project.created`, then opens the new project's dashboard. */
export function NewProjectPage(_props: PageProps) {
  const { t, submit, go } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (busy) return;
    const projectId = newId('p');
    const [cmd] = newProjectCommands({ projectId, name, description });
    if (!cmd) return;
    setBusy(true);
    const r = await submit(cmd.type, cmd.payload);
    setBusy(false);
    if (r.kind === 'accepted' || r.kind === 'duplicate') go({ view: 'dash', projectId });
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
        <Btn kind="primary" type="submit" disabled={!name.trim() || busy} testId="project-create">
          {t('pj.create')}
        </Btn>
      </form>
    </div>
  );
}
