import { useEffect, useState } from 'react';
import type { MeetlessBridge } from '@meetless/client/bridge';
import { AppProvider, useApp } from './app/AppContext';
import { SignIn } from './setup/SignIn';
import { Shell } from './shell/Shell';
import './setup/setup.css';

export function App({ bridge }: { bridge: MeetlessBridge | null }) {
  if (!bridge) return <NoBridge />;
  return (
    <AppProvider bridge={bridge}>
      <Root />
    </AppProvider>
  );
}

/** Shown outside the desktop app with no dev bridge: there is no locale yet, so both languages. */
function NoBridge() {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand">
          <span className="brand-mark" />
          Meetless
        </div>
        <p className="muted">No client bridge. Open this renderer inside the Meetless desktop app, or from a dev bridge host with ?bridge=&lt;url&gt;&amp;bridgeToken=&lt;token&gt;.</p>
        <p className="muted">未连接客户端桥接。请在 Meetless 桌面应用中打开，或通过开发用 bridge host 打开。</p>
      </div>
    </div>
  );
}

function Root() {
  const { snapshot } = useApp();
  return (
    <>
      {snapshot.session ? <Shell /> : <SignIn />}
      <NewBuild />
    </>
  );
}

/** Web: the server has a newer renderer build than this page (a `newBuild` event): offer a refresh. */
function NewBuild() {
  const { bridge, t } = useApp();
  const [shown, setShown] = useState(false);
  useEffect(() => bridge.subscribe((e) => e.type === 'newBuild' && setShown(true)), [bridge]);
  if (!shown) return null;
  return (
    <button type="button" className="chip new-build" data-testid="new-build" onClick={() => window.location.reload()}>
      {t('web.newBuild')}
    </button>
  );
}
