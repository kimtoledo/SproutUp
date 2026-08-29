import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { surfaceFromHost } from '@/lib/portal-surface';

export const metadata: Metadata = { title: 'Create account | SproutUp' };

export default async function RegisterPage() {
  const surface = surfaceFromHost((await headers()).get('host'));
  if (surface === 'admin') redirect('/login');
  return <AuthCard mode="register" surface={surface} />;
}
