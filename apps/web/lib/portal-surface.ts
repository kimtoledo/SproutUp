export type PortalSurface = 'main' | 'admin' | 'borrower' | 'investor';

export interface PortalSurfaceContent {
  label: string;
  eyebrow: string;
  headline: string;
  description: string;
  loginTitle: string;
  loginDescription: string;
  registerTitle?: string;
  registerDescription?: string;
  registrationIntent?: 'borrower' | 'investor';
  accent: string;
  highlights: readonly [string, string, string];
}

export const portalSurfaces: Record<PortalSurface, PortalSurfaceContent> = {
  main: {
    label: 'SproutUp',
    eyebrow: 'Philippine debt crowdfunding',
    headline: 'One trusted platform. Three focused experiences.',
    description:
      'Choose the workspace designed for your role while SproutUp keeps identity, permissions, and financial controls in one accountable system.',
    loginTitle: 'Sign in to SproutUp.',
    loginDescription: 'We will route your verified account to the right secure workspace.',
    registerTitle: 'Create your SproutUp account.',
    registerDescription: 'Choose your primary borrower or investor journey.',
    accent: 'platform',
    highlights: ['Purpose-built portals', 'One secure identity', 'Server-enforced access'],
  },
  admin: {
    label: 'SproutUp Operations',
    eyebrow: 'Controlled operations workspace',
    headline: 'Decisions move faster when the evidence stays clear.',
    description:
      'Review onboarding cases, manage dual-controlled access, and keep every privileged action traceable from one focused operations environment.',
    loginTitle: 'Sign in to Operations.',
    loginDescription: 'For authorized SproutUp staff using server-verified permissions.',
    accent: 'admin',
    highlights: ['Compliance queues', 'Maker-checker controls', 'Immutable audit evidence'],
  },
  borrower: {
    label: 'SproutUp for Business',
    eyebrow: 'Funding for Philippine SMEs',
    headline: 'Build the next chapter of your business.',
    description:
      'Start a guided financing journey, keep your application moving, and understand every next step from submission through decision.',
    loginTitle: 'Welcome back, builder.',
    loginDescription: 'Continue your business financing application securely.',
    registerTitle: 'Start your business journey.',
    registerDescription: 'Create an SME borrower account for the controlled pilot.',
    registrationIntent: 'borrower',
    accent: 'borrower',
    highlights: ['Guided application', 'Clear review status', 'Responsible growth capital'],
  },
  investor: {
    label: 'SproutUp Invest',
    eyebrow: 'Structured SME opportunities',
    headline: 'Put capital to work with greater clarity.',
    description:
      'Enter a focused investor experience built around transparent opportunities, documented terms, and auditable repayment flows.',
    loginTitle: 'Welcome back, investor.',
    loginDescription: 'Continue to your secure investor workspace.',
    registerTitle: 'Begin your investor journey.',
    registerDescription: 'Create an investor account for the controlled pilot.',
    registrationIntent: 'investor',
    accent: 'investor',
    highlights: ['Structured opportunities', 'Transparent terms', 'Auditable distributions'],
  },
};

export function surfaceFromHost(host: string | null | undefined): PortalSurface {
  const hostname = (host ?? '').split(':', 1)[0]?.toLowerCase();
  if (hostname === 'admin.lvh.me' || hostname?.startsWith('admin.')) return 'admin';
  if (hostname === 'borrower.lvh.me' || hostname?.startsWith('borrower.')) return 'borrower';
  if (
    hostname === 'investor.lvh.me'
    || hostname === 'investors.lvh.me'
    || hostname?.startsWith('investor.')
    || hostname?.startsWith('investors.')
  ) return 'investor';
  return 'main';
}

export function portalUrl(surface: Exclude<PortalSurface, 'main'>, path = '/'): string {
  const protocol = process.env.NEXT_PUBLIC_PORTAL_PROTOCOL ?? 'http';
  const domain = process.env.NEXT_PUBLIC_PORTAL_ROOT_DOMAIN ?? 'lvh.me';
  const port = process.env.NEXT_PUBLIC_PORTAL_PORT ?? '3000';
  const portSuffix = port ? `:${port}` : '';
  const pathname = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${surface}.${domain}${portSuffix}${pathname}`;
}
