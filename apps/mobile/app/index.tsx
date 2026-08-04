import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/state/auth';

export default function Index() {
  const { onboardingComplete, user } = useAuthStore();
  if (!onboardingComplete) return <Redirect href="/onboarding" />;
  if (!user) return <Redirect href="/auth" />;
  return <Redirect href="/(tabs)" />;
}
