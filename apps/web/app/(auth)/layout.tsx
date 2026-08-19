import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sprout } from 'lucide-react';
import { product } from '@/lib/product';

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="auth-page">
      <header className="site-header auth-header">
        <Link className="brand" href="/" aria-label="SproutUp home">
          <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
          {product.name}
        </Link>
        <Link className="quiet-link" href="/">Back to home</Link>
      </header>
      <section className="auth-shell" aria-label="Account access">
        {children}
      </section>
    </main>
  );
}
