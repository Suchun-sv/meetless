/** Owner: P0. Sign-in (personal token or invite code). Signed-in users go home. */
import { Redirect } from 'expo-router';
import { useApp } from '@/state';
import { SignInScreen } from '@/signin/SignInScreen';

export default function SignInRoute() {
  const { snapshot } = useApp();
  if (snapshot.session) return <Redirect href="/" />;
  return <SignInScreen />;
}
