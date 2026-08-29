import { headers } from 'next/headers';
import { SurfaceHome } from '@/components/surface-home';
import { surfaceFromHost } from '@/lib/portal-surface';

export default async function HomePage() {
  const surface = surfaceFromHost((await headers()).get('host'));
  return <SurfaceHome surface={surface} />;
}
