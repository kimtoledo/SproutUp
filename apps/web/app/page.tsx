import { ArrowRight, Building2, ShieldCheck, TrendingUp } from 'lucide-react';
import { product } from '@/lib/product';

const pillars = [
  {
    icon: Building2,
    title: 'Capital for growing SMEs',
    description: 'A guided path from business onboarding through credit review and funding.',
  },
  {
    icon: TrendingUp,
    title: 'Clear investor opportunities',
    description: 'Understand each approved campaign, its terms, and the repayment structure.',
  },
  {
    icon: ShieldCheck,
    title: 'Controls built into every step',
    description: 'Auditable approvals, immutable financial records, and server-enforced access.',
  },
] as const;

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SproutUp home">
          <span className="brand-mark" aria-hidden="true">S</span>
          {product.name}
        </a>
        <span className="status-badge">Foundation preview</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Philippine debt crowdfunding</p>
          <h1>Business growth, funded with clarity.</h1>
          <p className="lede">{product.description}</p>
          <a className="primary-action" href="#platform">
            Explore the foundation <ArrowRight aria-hidden="true" size={18} />
          </a>
        </div>
        <div className="hero-card" aria-label="Platform workflow preview">
          <p className="card-label">One accountable flow</p>
          <ol>
            <li><span>01</span> SME review</li>
            <li><span>02</span> Campaign funding</li>
            <li><span>03</span> Repayment distribution</li>
          </ol>
        </div>
      </section>

      <section className="pillars" id="platform" aria-labelledby="platform-title">
        <div className="section-heading">
          <p className="eyebrow">Platform principles</p>
          <h2 id="platform-title">A foundation designed for trust.</h2>
        </div>
        <div className="pillar-grid">
          {pillars.map(({ icon: Icon, title, description }) => (
            <article className="pillar" key={title}>
              <Icon aria-hidden="true" size={24} />
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
