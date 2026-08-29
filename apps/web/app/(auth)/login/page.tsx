import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AuthCard } from '@/components/auth-card';
import { surfaceFromHost } from '@/lib/portal-surface';

export const metadata: Metadata = { title: 'Sign in | SproutUp' };

export default async function LoginPage() {
  const surface = surfaceFromHost((await headers()).get('host'));
  return <AuthCard mode="login" surface={surface} />;
}
